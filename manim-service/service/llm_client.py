import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
import httpx
from .config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    VIDEO_MODEL,
    AICREDITS_API_KEY,
    AICREDITS_BASE_URL,
    AICREDITS_FALLBACK_BASE_URL,
)

logger = logging.getLogger("manim_service.llm")

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

            for attempt in range(1, max_attempts + 1):
                try:
                    logger.info(f"Calling LLM endpoint (stream): {endpoint} with model {gw_model} (attempt {attempt}/{max_attempts})")
                    async with client.stream("POST", endpoint, headers=headers, json=payload) as resp:
                        if resp.status_code == 200:
                            chunks = []
                            async for line in resp.aiter_lines():
                                if line.startswith("data: ") and line.strip() != "data: [DONE]":
                                    try:
                                        chunk_data = json.loads(line[6:])
                                        delta = chunk_data["choices"][0]["delta"].get("content", "")
                                        if delta:
                                            chunks.append(delta)
                                    except Exception:
                                        pass
                            full_text = "".join(chunks).strip()
                            if full_text:
                                return full_text
                        else:
                            body = await resp.aread()
                            err_text = body.decode("utf-8", errors="replace")[:300]
                            logger.warning(f"Endpoint {endpoint} returned status {resp.status_code}: {err_text}")
                            last_error = Exception(f"HTTP {resp.status_code}: {err_text}")
                            if resp.status_code in (502, 503, 504) and attempt < max_attempts:
                                await asyncio.sleep(2)
                                continue
                            break
                except Exception as e:
                    logger.warning(f"Connection failed to {endpoint} (attempt {attempt}/{max_attempts}): {e}")
                    last_error = e
                    if attempt < max_attempts:
                        await asyncio.sleep(2)
                        continue

    raise RuntimeError(f"All LLM gateways failed. Last error: {last_error}")

