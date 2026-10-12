import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
import httpx
import neatlogs
from opentelemetry.trace import Status, StatusCode
from .config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    VIDEO_MODEL,
    AICREDITS_API_KEY,
    AICREDITS_BASE_URL,
    AICREDITS_FALLBACK_BASE_URL,
)

logger = logging.getLogger("manim_service.llm")


def _record_request(span, provider: str, model: str, messages: List[Dict[str, str]], temperature: float, attempt: int) -> None:
    span.set_attribute("neatlogs.llm.provider", provider)
    span.set_attribute("neatlogs.llm.model_name", model)
    span.set_attribute("neatlogs.llm.is_streaming", True)
    span.set_attribute("neatlogs.llm.temperature", temperature)
    span.set_attribute("neatlogs.llm.invocation_parameters", json.dumps({"temperature": temperature, "attempt": attempt}))
    for i, msg in enumerate(messages):
        span.set_attribute(f"neatlogs.llm.input_messages.{i}.role", msg["role"])
        span.set_attribute(f"neatlogs.llm.input_messages.{i}.content", msg["content"])


def _record_response(span, text: str, usage: Optional[Dict[str, Any]], finish_reason: Optional[str]) -> None:
    span.set_attribute("neatlogs.llm.output_messages.0.role", "assistant")
    span.set_attribute("neatlogs.llm.output_messages.0.content", text)
    if finish_reason:
        span.set_attribute("neatlogs.llm.finish_reason", finish_reason)
    # Gateways only send usage on some streams; leave it unset rather than report a fake zero.
    if usage:
        for src, dst in (("prompt_tokens", "prompt"), ("completion_tokens", "completion"), ("total_tokens", "total")):
            if isinstance(usage.get(src), int):
                span.set_attribute(f"neatlogs.llm.token_count.{dst}", usage[src])

async def chat_completion(
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    temperature: float = 0.2,
    response_format: Optional[Dict[str, str]] = None,
    timeout: float = 120.0,
) -> str:
    """
    Call LLM chat completions via LiteLLM primary gateway, with AICredits fallback.
    """
    chosen_model = model or VIDEO_MODEL
    gateways = [
        {"base_url": LLM_BASE_URL, "api_key": LLM_API_KEY, "model": chosen_model, "attempts": 2},
        {"base_url": LLM_BASE_URL, "api_key": LLM_API_KEY, "model": "claude-sonnet-4.6", "attempts": 2},
        {"base_url": AICREDITS_BASE_URL, "api_key": AICREDITS_API_KEY, "model": "openai/gpt-4.1-mini", "attempts": 1},
        {"base_url": AICREDITS_FALLBACK_BASE_URL, "api_key": AICREDITS_API_KEY, "model": "openai/gpt-4.1-mini", "attempts": 1},
    ]

    last_error: Optional[Exception] = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        for gw in gateways:
            base_url = gw.get("base_url")
            api_key = gw.get("api_key")
            gw_model = gw.get("model") or chosen_model
            max_attempts = gw.get("attempts", 1)

            if not base_url or not api_key:
                continue

            endpoint = f"{base_url.rstrip('/')}/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            payload: Dict[str, Any] = {
                "model": gw_model,
                "messages": messages,
                "temperature": temperature,
                "stream": True,
            }
            if response_format:
                payload["response_format"] = response_format

            provider = "aicredits" if "aicredits" in base_url else "litellm"

            for attempt in range(1, max_attempts + 1):
                # One LLM span per HTTP attempt, so gateway fallbacks show up as separate failed calls.
                with neatlogs.trace(f"{provider}.chat", kind="LLM", **{"neatlogs.internal": False}) as span:
                    _record_request(span, provider, gw_model, messages, temperature, attempt)
                    try:
                        logger.info(f"Calling LLM endpoint (stream): {endpoint} with model {gw_model} (attempt {attempt}/{max_attempts})")
                        async with client.stream("POST", endpoint, headers=headers, json=payload) as resp:
                            if resp.status_code == 200:
                                chunks = []
                                usage = None
                                finish_reason = None
                                async for line in resp.aiter_lines():
                                    if line.startswith("data: ") and line.strip() != "data: [DONE]":
                                        try:
                                            chunk_data = json.loads(line[6:])
                                            usage = chunk_data.get("usage") or usage
                                            choice = chunk_data["choices"][0]
                                            finish_reason = choice.get("finish_reason") or finish_reason
                                            delta = choice["delta"].get("content", "")
                                            if delta:
                                                chunks.append(delta)
                                        except Exception:
                                            pass
                                full_text = "".join(chunks).strip()
                                _record_response(span, full_text, usage, finish_reason)
                                if full_text:
                                    return full_text
                                span.set_status(Status(StatusCode.ERROR, "empty response"))
                            else:
                                body = await resp.aread()
                                err_text = body.decode("utf-8", errors="replace")[:300]
                                logger.warning(f"Endpoint {endpoint} returned status {resp.status_code}: {err_text}")
                                last_error = Exception(f"HTTP {resp.status_code}: {err_text}")
                                span.set_status(Status(StatusCode.ERROR, str(last_error)))
                                if resp.status_code in (502, 503, 504) and attempt < max_attempts:
                                    await asyncio.sleep(2)
                                    continue
                                break
                    except Exception as e:
                        logger.warning(f"Connection failed to {endpoint} (attempt {attempt}/{max_attempts}): {e}")
                        last_error = e
                        span.record_exception(e)
                        span.set_status(Status(StatusCode.ERROR, str(e)))
                        if attempt < max_attempts:
                            await asyncio.sleep(2)
                            continue

    raise RuntimeError(f"All LLM gateways failed. Last error: {last_error}")

