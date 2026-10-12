import json
import logging
import re
from typing import Dict, Any, List
import neatlogs
from .llm_client import chat_completion

logger = logging.getLogger("manim_service.repair")

REPAIR_SYSTEM_PROMPT = """You are an expert Manim Community code debugger.
Your mission is to fix broken Manim code based on the compiler error and traceback provided by the user.

CRITICAL RULES:
1. Review the EXACT traceback, error type, and line number reported.
2. Fix the error directly. Common Manim pitfalls to avoid:
   - NEVER use SVGMobject(string=...). SVGMobject only accepts a file_name path, NOT a string. Use native Manim vector shapes: Circle, Square, RoundedRectangle, Polygon, Dot, Line, Arrow, Cross.
   - NEVER call self.play() or animations with run_time <= 0 or run_time=0. Always use positive run_time (e.g. 0.05 or 0.1).
   - NEVER call self.wait(0) or wait duration <= 0. Always use positive duration (e.g. 0.1).
   - Do NOT chain invalid animation methods like .set_delay() or .set_run_time().
   - Hallucinated methods: e.g. .set_color_by_gradient() on Text (use .set_color() or t2c dict on Text).
   - Never use Tex/MathTex unless required; use Text("...", font_size=..., color=...).
   - Calling .animate on an object that is already removed or not added.
   - Coordinate mismatches or division by zero.
   - NEVER use Transform() on Text mobjects. Use FadeOut(old) + FadeIn(new).
   - Ensure all horizontal positions stay strictly within [-2.8, +2.8] to prevent edge clipping.
   - End each act with self.play(FadeOut(*self.mobjects), run_time=0.6), self.clear(), self.wait(0.1).
   - Invalid shapes: RoundedRectangle takes corner_radius, width, height.
   - Arrow takes start and end points (e.g., start=LEFT, end=RIGHT).
   - Scene class: class ReelScene(MovingCameraScene) or ReelScene(Scene).
3. Preserve the 9:16 vertical configuration:
   config.pixel_width = 1080
   config.pixel_height = 1920
   config.frame_width = 9.0
   config.frame_height = 16.0
   config.background_color = "#0B0C10"
4. Class name MUST be ReelScene(MovingCameraScene) or ReelScene(Scene).
5. Output format:
   Return ONLY the complete, standalone, corrected python code inside a ```python ``` code block.
   Do NOT output conversational explanations or notes outside the code block.
"""

def add_line_numbers(code: str) -> str:
    lines = code.splitlines()
    return "\n".join(f"{i+1:4d}: {line}" for i, line in enumerate(lines))

@neatlogs.span(kind="CHAIN", name="repair_manim_code")
async def repair_manim_code(
    broken_code: str,
    error_summary: str,
    traceback: str,
    prompt: str,
) -> Dict[str, Any]:
    """
    Asks the LLM to analyze the traceback and repair the broken Manim code.
    """
    code_with_lines = add_line_numbers(broken_code)

    user_message = f"""The following Manim Python script failed to render for topic "{prompt}".

ERROR SUMMARY:
{error_summary}

TRACEBACK:
{traceback}

CURRENT CODE (with line numbers):
```python
{code_with_lines}
```

Please diagnose the failure, fix the issue, and provide the complete corrected code inside a ```python ``` block.
"""

    messages = [
        {"role": "system", "content": REPAIR_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    response_text = await chat_completion(
        messages=messages,
        temperature=0.1,
        response_format=None,
    )

    cleaned_text = response_text.strip()
    code_result = None

    # 1. Primary: Extract from ```python ... ``` code block
    py_matches = re.findall(r"```(?:python)?\s*([\s\S]*?)\s*```", cleaned_text)
    for block in py_matches:
        if "class ReelScene" in block or "construct(" in block or "from manim" in block:
            code_result = block.strip()
            break

    # 2. Try JSON parsing if returned as JSON
    if not code_result:
        json_obj_match = re.search(r"(\{[\s\S]*\})", cleaned_text)
        if json_obj_match:
            try:
                data = json.loads(json_obj_match.group(1), strict=False)
                if isinstance(data, dict) and "code" in data:
                    inner_code = str(data["code"]).strip()
                    inner_py = re.search(r"```(?:python)?\s*([\s\S]*?)\s*```", inner_code)
                    code_result = inner_py.group(1).strip() if inner_py else inner_code
            except Exception:
                # Regex fallback for "code": "..."
                code_field = re.search(r'"code"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*\}\s*$)', cleaned_text)
                if code_field:
                    code_result = code_field.group(1).replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\").strip()

    # 3. If raw code with conversational preamble: locate the first real Python code line
    if not code_result:
        code_start = re.search(r"(?m)^(?:from\s+manim\s+import|import\s+manim|config\.pixel|class\s+ReelScene|#\s*---\s*GLOBAL|def\s+get_icon)\b", cleaned_text)
        if code_start:
            raw_slice = cleaned_text[code_start.start():].strip()
            # Strip trailing JSON closing braces or quotes
            raw_slice = re.sub(r'["\s\}]+$', '', raw_slice)
            code_result = raw_slice

    if not code_result:
        code_result = broken_code

    # Strip any accidental outer backticks
    code_result = re.sub(r"^```(?:python)?\s*", "", code_result)
    code_result = re.sub(r"\s*```$", "", code_result)

    return {
        "diagnosis": "Code repaired",
        "code": code_result.strip(),
    }
