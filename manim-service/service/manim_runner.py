import asyncio
import json
import os
import re
import shutil
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("manim_service.runner")

COMPATIBILITY_PREAMBLE = """
import os
import tempfile
from pathlib import Path
import numpy as np
from manim import *

# Vertical 9:16 Reel canvas configuration
config.pixel_width = 1080
config.pixel_height = 1920
config.frame_width = 9.0
config.frame_height = 16.0
config.background_color = "#0B0C10"

# Common motion-graphics compatibility shims
_orig_wait = Scene.wait
def _safe_wait(self, duration=1.0, *args, **kwargs):
    if duration is not None and duration <= 0:
        return
    return _orig_wait(self, duration, *args, **kwargs)
Scene.wait = _safe_wait

_orig_compile = Scene.compile_animation_data
def _safe_compile(self, *animations, **play_kwargs):
    if len(animations) == 0:
        animations = (Wait(0.01),)
    return _orig_compile(self, *animations, **play_kwargs)
Scene.compile_animation_data = _safe_compile

_orig_play = Scene.play
def _safe_play(self, *args, **kwargs):
    if "run_time" in kwargs and (kwargs["run_time"] is None or kwargs["run_time"] <= 0):
        kwargs["run_time"] = 0.05
    for anim in args:
        if hasattr(anim, "run_time") and (anim.run_time is None or anim.run_time <= 0):
            anim.run_time = 0.05
    return _orig_play(self, *args, **kwargs)
Scene.play = _safe_play

_orig_svg = SVGMobject.__init__
def _safe_svg_init(self, file_name=None, **kwargs):
    if "string" in kwargs or "content" in kwargs:
        svg_text = kwargs.pop("string", None) or kwargs.pop("content", "")
        fd, path = tempfile.mkstemp(suffix=".svg")
        with os.fdopen(fd, "w") as f:
            f.write(svg_text)
        file_name = path
    return _orig_svg(self, file_name, **kwargs)
SVGMobject.__init__ = _safe_svg_init

_orig_text_init = Text.__init__
def _safe_text_init(self, text, *args, **kwargs):
    _orig_text_init(self, text, *args, **kwargs)
    if hasattr(self, "width") and self.width > 5.2:
        self.scale_to_fit_width(5.2)
Text.__init__ = _safe_text_init

try:
    from manim.utils.color.core import ManimColor
    _orig_manim_color_init = ManimColor.__init__
    def _safe_manim_color_init(self, value=None, *args, **kwargs):
        try:
            _orig_manim_color_init(self, value, *args, **kwargs)
        except Exception:
            _orig_manim_color_init(self, "#FFFFFF", *args, **kwargs)
    ManimColor.__init__ = _safe_manim_color_init
except Exception:
    pass


def Shake(mobject, scale=0.1, **kwargs):
    return Wiggle(mobject, scale_value=1.0 + scale, **kwargs)

class Cross(VGroup):
    def __init__(self, mobject=None, stroke_width=4, color=RED, scale=1.0, **kwargs):
        super().__init__(**kwargs)
        l1 = Line(start=LEFT*0.35 + DOWN*0.35, end=RIGHT*0.35 + UP*0.35, stroke_width=stroke_width, color=color)
        l2 = Line(start=LEFT*0.35 + UP*0.35, end=RIGHT*0.35 + DOWN*0.35, stroke_width=stroke_width, color=color)
        self.add(l1, l2)
        if mobject is not None:
            self.move_to(mobject.get_center())
            self.scale(scale)

class Checkmark(VGroup):
    def __init__(self, mobject=None, stroke_width=4, color="#10B981", scale=1.0, **kwargs):
        super().__init__(**kwargs)
        l1 = Line(start=LEFT*0.35 + ORIGIN, end=LEFT*0.10 + DOWN*0.28, stroke_width=stroke_width, color=color)
        l2 = Line(start=LEFT*0.10 + DOWN*0.28, end=RIGHT*0.35 + UP*0.35, stroke_width=stroke_width, color=color)
        self.add(l1, l2)
        if mobject is not None:
            self.move_to(mobject.get_center())
            self.scale(scale)

def get_icon(name="user", color="#38BDF8", scale=1.0):
    \"\"\"
    Load real vector icon assets (SVG or native vector).
    Available: 'user', 'users', 'server', 'database', 'redis', 'cpu', 'cloud', 'bolt', 'shield', 'lock', 'globe', 'activity'
    \"\"\"
    svg_candidates = [
        Path(f"/app/service/assets/icons/{name}.svg"),
        Path(f"service/assets/icons/{name}.svg"),
        Path(f"assets/icons/{name}.svg"),
    ]
    for p in svg_candidates:
        if p.exists():
            try:
                mob = SVGMobject(str(p))
                mob.set_color(color)
                mob.scale(0.35 * scale)
                return mob
            except Exception:
                pass

    if name == "user":
        head = Circle(radius=0.18 * scale, fill_color=color, fill_opacity=1.0, stroke_color=color, stroke_width=1.0).move_to(UP * 0.22 * scale)
        torso = Arc(radius=0.34 * scale, start_angle=PI * 0.12, angle=PI * 0.76, color=color, stroke_width=3.5).move_to(DOWN * 0.16 * scale)
        return VGroup(head, torso)
    elif name == "users":
        u1 = get_icon("user", color=color, scale=scale * 0.82).move_to(LEFT * 0.24 * scale + DOWN * 0.04 * scale)
        u2 = get_icon("user", color=color, scale=scale * 0.82).move_to(RIGHT * 0.24 * scale + DOWN * 0.04 * scale)
        u3 = get_icon("user", color=color, scale=scale).move_to(ORIGIN)
        return VGroup(u1, u2, u3)
    elif name == "database":
        c1 = Ellipse(width=0.7 * scale, height=0.22 * scale, color=color, fill_color=color, fill_opacity=0.3, stroke_width=2).move_to(UP * 0.22 * scale)
        c2 = Ellipse(width=0.7 * scale, height=0.22 * scale, color=color, fill_color=color, fill_opacity=0.3, stroke_width=2).move_to(ORIGIN)
        c3 = Ellipse(width=0.7 * scale, height=0.22 * scale, color=color, fill_color=color, fill_opacity=0.3, stroke_width=2).move_to(DOWN * 0.22 * scale)
        return VGroup(c3, c2, c1)
    elif name == "server":
        b1 = RoundedRectangle(corner_radius=0.06, width=0.8 * scale, height=0.3 * scale, color=color, fill_color="#0F172A", fill_opacity=1.0, stroke_width=1.8).move_to(UP * 0.18 * scale)
        b2 = RoundedRectangle(corner_radius=0.06, width=0.8 * scale, height=0.3 * scale, color=color, fill_color="#0F172A", fill_opacity=1.0, stroke_width=1.8).move_to(DOWN * 0.18 * scale)
        return VGroup(b1, b2)
    elif name == "bolt":
        return Triangle(color=color, fill_color=color, fill_opacity=1.0).scale(0.18 * scale).rotate(PI)
    else:
        return Dot(radius=0.15 * scale, color=color)

def UserIcon(color="#38BDF8", scale=1.0):
    return get_icon("user", color=color, scale=scale)

def UsersGroupIcon(color="#38BDF8", scale=1.0):
    return get_icon("users", color=color, scale=scale)

def ServerIcon(color="#38BDF8", scale=1.0):
    return get_icon("server", color=color, scale=scale)

def DatabaseIcon(color="#3B82F6", scale=1.0):
    return get_icon("database", color=color, scale=scale)

def RedisIcon(color="#EF4444", scale=1.0):
    return get_icon("redis", color=color, scale=scale)

def CpuIcon(color="#F59E0B", scale=1.0):
    return get_icon("cpu", color=color, scale=scale)

def CloudIcon(color="#38BDF8", scale=1.0):
    return get_icon("cloud", color=color, scale=scale)

def BoltIcon(color="#FFD700", scale=1.0):
    return get_icon("bolt", color=color, scale=scale)

def ShieldIcon(color="#10B981", scale=1.0):
    return get_icon("shield", color=color, scale=scale)

def LockIcon(color="#EF4444", scale=1.0):
    return get_icon("lock", color=color, scale=scale)

def GlobeIcon(color="#38BDF8", scale=1.0):
    return get_icon("globe", color=color, scale=scale)

def create_kicker_badge(text, color="#00F2FE", font_size=14, **kwargs):
    label = Text(str(text), font_size=font_size, color=color, weight=BOLD)
    pill = RoundedRectangle(
        corner_radius=0.14,
        width=label.width + 0.50,
        height=label.height + 0.26,
        fill_color="#121622",
        fill_opacity=0.95,
        stroke_color=color,
        stroke_width=1.5,
        **kwargs
    )
    return VGroup(pill, label.move_to(pill.get_center()))

def VisualHeadline(badge_text, title, subtitle=None, color="#00F2FE"):
    badge = create_kicker_badge(badge_text, color=color, font_size=14)
    t = Text(str(title), font_size=28, color=WHITE, weight=BOLD)
    if hasattr(t, "width") and t.width > 4.4:
        t.scale_to_fit_width(4.4)
    group = VGroup(badge, t)
    if subtitle:
        sub = Text(str(subtitle), font_size=16, color="#94A3B8")
        if hasattr(sub, "width") and sub.width > 4.4:
            sub.scale_to_fit_width(4.4)
        group.add(sub)
    group.arrange(DOWN, buff=0.16)
    group.move_to(UP * 4.6)
    return group

def IconCard(label, subtext=None, icon_name="server", color="#38BDF8", width=2.0, height=2.2):
    # Universal entity card for ANY concept (Server, Database, User, Planet, Nucleus, Bank, etc.)
    box = RoundedRectangle(corner_radius=0.18, width=width, height=height, fill_color="#121622", fill_opacity=0.96, stroke_color=color, stroke_width=2.0)
    icon = get_icon(icon_name, color=color, scale=0.85).move_to(box.get_top() + DOWN * 0.42)
    lbl = Text(str(label), font_size=15, color=color, weight=BOLD).next_to(icon, DOWN, buff=0.10)
    if hasattr(lbl, "width") and lbl.width > width - 0.2:
        lbl.scale_to_fit_width(width - 0.2)
    group = VGroup(box, icon, lbl)
    if subtext:
        sub = Text(str(subtext), font_size=10, color="#94A3B8").next_to(lbl, DOWN, buff=0.06)
        if hasattr(sub, "width") and sub.width > width - 0.2:
            sub.scale_to_fit_width(width - 0.2)
        group.add(sub)
    return group

def MetricBar(label="CPU USAGE", value="100%", pct=1.0, color="#EF4444", width=3.8, height=0.55):
    container = RoundedRectangle(corner_radius=0.12, width=width, height=height, fill_color="#1E293B", fill_opacity=0.95, stroke_color="#334155", stroke_width=1.2)
    fill_max = width - 0.20
    fill_w = max(0.20, fill_max * min(1.0, max(0.04, pct)))
    fill = RoundedRectangle(corner_radius=0.08, width=fill_w, height=height - 0.14, fill_color=color, fill_opacity=0.95, stroke_width=0)
    fill.move_to(container.get_left() + RIGHT * (fill_w / 2.0 + 0.10))
    lbl = Text(str(label), font_size=13, color=WHITE, weight=BOLD).move_to(container.get_left() + RIGHT * 0.85)
    if hasattr(lbl, "width") and lbl.width > width * 0.55:
        lbl.scale_to_fit_width(width * 0.55)
    val = Text(str(value), font_size=14, color=WHITE, weight=BOLD).move_to(container.get_right() + LEFT * 0.65)
    if hasattr(val, "width") and val.width > width * 0.35:
        val.scale_to_fit_width(width * 0.35)
    grp = VGroup(container, fill, lbl, val)
    grp.container = container
    grp.bg = container
    grp.bg_ref = container
    grp.fill = fill
    grp.fill_ref = fill
    grp.lbl = lbl
    grp.lbl_ref = lbl
    grp.val = val
    grp.val_ref = val
    grp.bar_width = width
    grp.bar_height = height
    grp.pct = pct
    return grp

def AnimateMetric(scene, metric_bar, new_val="100%", new_pct=1.0, new_color="#EF4444", run_time=0.6):
    old_pos = metric_bar.get_center()
    lbl_text = "CPU"
    try:
        lbl_text = metric_bar[2].text
    except Exception:
        pass
    new_bar = MetricBar(label=lbl_text, value=new_val, pct=new_pct, color=new_color, width=metric_bar[0].width, height=metric_bar[0].height).move_to(old_pos)
    scene.play(Transform(metric_bar, new_bar), run_time=run_time)

def GlowArrow(start_point, end_point, label=None, color="#00F2FE", curved=False, stroke_width=3.5):
    if curved:
        curve = CubicBezier(start_point, start_point + UP*0.35, end_point + UP*0.35, end_point, stroke_color=color, stroke_width=stroke_width)
        glow = CubicBezier(start_point, start_point + UP*0.35, end_point + UP*0.35, end_point, stroke_color=color, stroke_width=stroke_width+4, stroke_opacity=0.3)
        tip = Triangle(color=color, fill_color=color, fill_opacity=1.0).scale(0.12).move_to(end_point)
        group = VGroup(glow, curve, tip)
    else:
        glow = Line(start_point, end_point, stroke_color=color, stroke_width=stroke_width+4, stroke_opacity=0.3)
        core = Arrow(start=start_point, end=end_point, color=color, stroke_width=stroke_width, buff=0.1, max_tip_length_to_length_ratio=0.2)
        group = VGroup(glow, core)
    if label:
        pill = RoundedRectangle(corner_radius=0.10, width=len(str(label))*0.13 + 0.45, height=0.38, fill_color="#0A0E17", fill_opacity=1.0, stroke_color=color, stroke_width=1.2)
        pill.move_to((start_point + end_point)/2 + UP * 0.32)
        txt = Text(str(label), font_size=11, color=color, weight=BOLD).move_to(pill.get_center())
        group.add(pill, txt)
    return group

def PunchIn(scene, target, scale=0.8, run_time=0.6):
    if hasattr(scene, "camera") and hasattr(scene.camera, "frame"):
        if isinstance(target, (list, tuple)):
            grp = VGroup(*target)
            center = grp.get_center()
            width = grp.width
        elif hasattr(target, "get_center"):
            center = target.get_center()
            width = getattr(target, "width", 3.0)
        else:
            center = np.array(target)
            width = 3.0

        target_width = 9.0 * scale if scale else max(5.4, min(8.5, width * 1.5))
        cx = float(np.clip(center[0], -0.9, 0.9))
        cy = float(np.clip(center[1], -1.8, 2.8))
        target_pt = np.array([cx, cy, 0.0])
        scene.play(
            scene.camera.frame.animate.set(width=target_width).move_to(target_pt),
            run_time=run_time
        )

def PunchOut(scene, run_time=0.5):
    if hasattr(scene, "camera") and hasattr(scene.camera, "frame"):
        scene.play(
            scene.camera.frame.animate.set(width=9.0).move_to(ORIGIN),
            run_time=run_time
        )

def FocusArea(scene, targets, margin=1.4, run_time=0.6):
    PunchIn(scene, targets, scale=0.82, run_time=run_time)

def ShowOverview(scene, run_time=0.5):
    PunchOut(scene, run_time=run_time)

def TelemetryBar(metric_label="SYSTEM STATUS", value_text="ACTIVE", status_color="#10B981"):
    container = RoundedRectangle(corner_radius=0.16, width=4.4, height=0.65, fill_color="#121622", fill_opacity=0.95, stroke_color="#334155", stroke_width=1.5)
    container.move_to(DOWN * 2.6)
    dot = Dot(radius=0.08, color=status_color).move_to(container.get_left() + RIGHT * 0.35)
    lbl = Text(str(metric_label), font_size=15, color="#94A3B8", weight=BOLD).next_to(dot, RIGHT, buff=0.15)
    val = Text(str(value_text), font_size=16, color=status_color, weight=BOLD).move_to(container.get_right() + LEFT * 1.0)
    if hasattr(val, "width") and val.width > 2.0:
        val.scale_to_fit_width(2.0)
    return VGroup(container, dot, lbl, val)

def VerdictBanner(title="VERDICT", subtitle=None, color="#FFD700", width=4.4, height=1.1):
    box = RoundedRectangle(corner_radius=0.18, width=width, height=height, fill_color="#141824", fill_opacity=0.95, stroke_color=color, stroke_width=2.0)
    box.move_to(DOWN * 2.4)
    t = Text(str(title), font_size=18, color=color, weight=BOLD).move_to(box.get_center() + (UP * 0.16 if subtitle else ORIGIN))
    group = VGroup(box, t)
    if subtitle:
        s = Text(str(subtitle), font_size=14, color=WHITE).next_to(t, DOWN, buff=0.10)
        if hasattr(s, "width") and s.width > width - 0.4:
            s.scale_to_fit_width(width - 0.4)
        group.add(s)
    return group

def SummaryCard(title="KEY TAKEAWAYS", rows=None, width=4.4):
    if rows is None:
        rows = [("POINT 1", "Core insight", "#00F2FE")]
    card = RoundedRectangle(corner_radius=0.20, width=width, height=len(rows) * 1.25 + 0.9, fill_color="#121622", fill_opacity=0.96, stroke_color="#00F2FE", stroke_width=1.8)
    card.move_to(DOWN * 0.1)
    head_txt = Text(str(title), font_size=18, color="#00F2FE", weight=BOLD).move_to(card.get_top() + DOWN * 0.40)
    row_groups = VGroup()
    colors = ["#00F2FE", "#10B981", "#FFD700", "#F43F5E"]
    for idx, row in enumerate(rows):
        if isinstance(row, str):
            tag, desc, tag_color = f"POINT {idx + 1}", row, colors[idx % len(colors)]
        elif isinstance(row, (list, tuple)):
            tag = row[0]
            desc = row[1] if len(row) > 1 else ""
            tag_color = row[2] if len(row) > 2 and str(row[2]).startswith("#") else colors[idx % len(colors)]
        else:
            tag, desc, tag_color = f"POINT {idx + 1}", str(row), colors[idx % len(colors)]

        r_box = RoundedRectangle(corner_radius=0.12, width=width - 0.4, height=1.0, fill_color="#090D16", fill_opacity=1.0, stroke_color="#1E293B", stroke_width=1.2)
        tag_lbl = Text(str(tag), font_size=15, color=tag_color, weight=BOLD).move_to(r_box.get_top() + DOWN * 0.28)
        desc_txt = Text(str(desc), font_size=14, color=WHITE).move_to(r_box.get_bottom() + UP * 0.28)
        if hasattr(desc_txt, "width") and desc_txt.width > width - 0.6:
            desc_txt.scale_to_fit_width(width - 0.6)
        row_groups.add(VGroup(r_box, tag_lbl, desc_txt))
    row_groups.arrange(DOWN, buff=0.14).move_to(card.get_center() + DOWN * 0.26)
    return VGroup(card, head_txt, row_groups)

def ImpactScreen(title="CRITICAL EVENT", subtitle=None, icon_type="cross", color="#EF4444"):
    bg = Rectangle(width=9.0, height=16.0, fill_color="#08090D", fill_opacity=1.0, stroke_width=0)
    glow_ring = Circle(radius=1.8, stroke_color=color, stroke_width=2.5, stroke_opacity=0.4, fill_color=color, fill_opacity=0.08).move_to(UP * 1.6)
    icon = Cross(stroke_color=color, stroke_width=8, scale=1.6).move_to(glow_ring.get_center()) if icon_type == "cross" else Checkmark(stroke_color=color, stroke_width=8, scale=1.6).move_to(glow_ring.get_center())
    title_txt = Text(str(title), font_size=38, color=WHITE, weight=BOLD).move_to(DOWN * 0.4)
    if hasattr(title_txt, "width") and title_txt.width > 7.4:
        title_txt.scale_to_fit_width(7.4)
    group = VGroup(bg, glow_ring, icon, title_txt)
    if subtitle:
        sub_txt = Text(str(subtitle), font_size=18, color="#94A3B8").next_to(title_txt, DOWN, buff=0.30)
        if hasattr(sub_txt, "width") and sub_txt.width > 7.4:
            sub_txt.scale_to_fit_width(7.4)
        group.add(sub_txt)
    return group

"""

def extract_pure_python_code(raw_code: str) -> str:
    """
    Robustly extracts pure Python code from LLM responses, stripping any markdown code fences,
    JSON wrapping, conversational chatter, or diagnostic preambles.
    """
    text = raw_code.strip()

    # 1. Check for markdown code fences: ```python ... ``` or ``` ... ```
    py_blocks = re.findall(r"```(?:python)?\s*([\s\S]*?)\s*```", text)
    for block in py_blocks:
        if "class ReelScene" in block or "construct(" in block or "from manim" in block:
            return block.strip()

    # 2. Check if wrapped in JSON: {"code": "...", ...}
    json_match = re.search(r"(\{[\s\S]*\})", text)
    if json_match:
        try:
            parsed = json.loads(json_match.group(1), strict=False)
            if isinstance(parsed, dict) and "code" in parsed:
                code_inner = str(parsed["code"]).strip()
                inner_py = re.search(r"```(?:python)?\s*([\s\S]*?)\s*```", code_inner)
                if inner_py:
                    code_inner = inner_py.group(1).strip()
                if "class ReelScene" in code_inner or "construct(" in code_inner or "from manim" in code_inner:
                    return code_inner
        except Exception:
            pass

        # Regex fallback for "code": "..." inside broken/escaped JSON
        code_field_match = re.search(r'"code"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*\}\s*$)', text)
        if code_field_match:
            extracted = code_field_match.group(1).replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
            if "class ReelScene" in extracted or "construct(" in extracted or "from manim" in extracted:
                return extracted.strip()

    # 3. If conversational text precedes code, locate the first real code start line
    code_start_match = re.search(r"(?m)^(?:from\s+manim\s+import|import\s+manim|config\.pixel|class\s+ReelScene|#\s*---\s*GLOBAL|def\s+get_icon)\b", text)
    if code_start_match:
        pure_code = text[code_start_match.start():]
        pure_code = re.sub(r'["\s\}]+$', '', pure_code)
        return pure_code.strip()

    # 4. Fallback: strip outer backticks
    text = re.sub(r"^```(?:python|json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

def prepare_script_code(code: str) -> str:
    """
    Ensure required imports, helper shims, and safe screen boundaries are present in the script.
    """
    clean_code = extract_pure_python_code(code)

    # Automatic coordinate clamping to prevent off-screen clipping on 9:16 vertical displays
    clean_code = re.sub(r"LEFT\s*\*\s*4\.[0-9]+", "LEFT*2.0", clean_code)
    clean_code = re.sub(r"LEFT\s*\*\s*4\b", "LEFT*2.0", clean_code)
    clean_code = re.sub(r"LEFT\s*\*\s*3\.[0-9]+", "LEFT*2.0", clean_code)
    clean_code = re.sub(r"LEFT\s*\*\s*2\.[4-9]", "LEFT*2.0", clean_code)
    clean_code = re.sub(r"RIGHT\s*\*\s*4\.[0-9]+", "RIGHT*2.0", clean_code)
    clean_code = re.sub(r"RIGHT\s*\*\s*4\b", "RIGHT*2.0", clean_code)
    clean_code = re.sub(r"RIGHT\s*\*\s*3\.[0-9]+", "RIGHT*2.0", clean_code)
    clean_code = re.sub(r"RIGHT\s*\*\s*2\.[4-9]", "RIGHT*2.0", clean_code)
    clean_code = re.sub(r"np\.array\(\[\s*-4\.[0-9]+", "np.array([-2.0", clean_code)
    clean_code = re.sub(r"np\.array\(\[\s*-4\b", "np.array([-2.0", clean_code)
    clean_code = re.sub(r"np\.array\(\[\s*4\.[0-9]+", "np.array([2.0", clean_code)
    clean_code = re.sub(r"np\.array\(\[\s*4\b", "np.array([2.0", clean_code)

    # Clamp vertical coordinates away from platform UI danger zone (Y < -3.0 and Y > 5.0)
    clean_code = re.sub(r"DOWN\s*\*\s*5\.[0-9]+", "DOWN*2.6", clean_code)
    clean_code = re.sub(r"DOWN\s*\*\s*5\b", "DOWN*2.6", clean_code)
    clean_code = re.sub(r"DOWN\s*\*\s*4\.[0-9]+", "DOWN*2.4", clean_code)
    clean_code = re.sub(r"DOWN\s*\*\s*4\b", "DOWN*2.4", clean_code)
    clean_code = re.sub(r"UP\s*\*\s*5\.[0-9]+", "UP*4.6", clean_code)
    clean_code = re.sub(r"UP\s*\*\s*5\b", "UP*4.6", clean_code)

    # Strip LLM duplicate helper class definitions so COMPATIBILITY_PREAMBLE versions are used
    helper_classes = [
        "VisualHeadline", "TelemetryBar", "SummaryCard", "VerdictBanner",
        "Checkmark", "Cross", "ImpactScreen", "MetricBar", "AnimateMetric",
        "get_icon", "IconCard", "GlowArrow", "PunchIn", "PunchOut",
        "FocusArea", "ShowOverview"
    ]
    for h_cls in helper_classes:
        pattern = rf"(?ms)^class\s+{h_cls}\b.*?(?=^(?:class|def\s+[a-zA-Z_]|config|\#\s*───\s*MAIN|\Z))"
        clean_code = re.sub(pattern, "", clean_code)
        pattern_func = rf"(?ms)^def\s+{h_cls}\b.*?(?=^(?:class|def\s+[a-zA-Z_]|config|\#\s*───\s*MAIN|\Z))"
        clean_code = re.sub(pattern_func, "", clean_code)

    # Ensure arena objects are faded out before SummaryCard appears (prevents overlapping clutter)
    if "_arena" not in clean_code:
        clean_code = re.sub(
            r"(?m)^(\s*)(self\.play\(FadeIn\((?:summary|sc)[^\)]*\))",
            r"\1# Cleanly clear arena objects before presenting SummaryCard\n\1_arena = [m for m in self.mobjects if m.get_center()[1] < 4.2]\n\1if _arena:\n\1    self.play(FadeOut(*_arena), run_time=0.35)\n\1\2",
            clean_code,
            count=1
        )

    # Clamp entrance scale animations that blow objects past screen bounds
    clean_code = re.sub(r"scale\s*=\s*1\.[2-9][0-9]*", "scale=1.05", clean_code)
    clean_code = re.sub(r"scale\s*=\s*[2-9](\.[0-9]+)?", "scale=1.05", clean_code)

    # Strip hallucinated internal submodule imports since COMPATIBILITY_PREAMBLE handles everything
    clean_code = re.sub(r"from\s+manim\.[a-zA-Z0-9_\.]+\s+import\s+.*", "", clean_code)

    # Ensure ReelScene inherits from MovingCameraScene for camera focus zoom capabilities
    clean_code = re.sub(r"class\s+ReelScene\s*\(\s*Scene\s*\)\s*:", "class ReelScene(MovingCameraScene):", clean_code)

    # Prepend COMPATIBILITY_PREAMBLE (safe monkey patches, geometry helpers, shims)
    if "from manim import *" in clean_code:
        clean_code = clean_code.replace("from manim import *", COMPATIBILITY_PREAMBLE.strip(), 1)
    else:
        clean_code = f"{COMPATIBILITY_PREAMBLE.strip()}\n\n{clean_code}"

    return clean_code

async def render_manim_code(
    code: str,
    job_dir: Path,
    scene_name: str = "ReelScene",
    quality: str = "h", # 'l' for low/fast 480p, 'h' for 1080p
    timeout: float = 300.0,
) -> Dict[str, Any]:
    """
    Renders Manim Python code in a subprocess.
    """
    job_dir.mkdir(parents=True, exist_ok=True)
    prepared_code = prepare_script_code(code)
    script_path = job_dir / "scene.py"
    script_path.write_text(prepared_code, encoding="utf-8")

    # Command: manim -q<quality> scene.py <scene_name> --media_dir <media_dir>
    media_dir = job_dir / "media"
    cmd = [
        "manim",
        f"-q{quality}",
        "-r", "1080,1920",
        "--format", "mp4",
        "--media_dir", str(media_dir),
        str(script_path),
        scene_name,
    ]

    logger.info(f"Running manim command: {' '.join(cmd)}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(job_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {
            "success": False,
            "video_path": None,
            "stdout": "",
            "stderr": f"Render timed out after {timeout} seconds",
            "error_summary": "Execution timed out",
            "traceback": f"Timeout of {timeout}s exceeded while rendering Manim scene.",
        }
    except Exception as e:
        return {
            "success": False,
            "video_path": None,
            "stdout": "",
            "stderr": str(e),
            "error_summary": f"Process launch failed: {e}",
            "traceback": str(e),
        }

    if proc.returncode != 0:
        logger.warning(f"Manim render failed with return code {proc.returncode}")
        full_log = f"{stdout}\n{stderr}"
        error_summary, tb = extract_manim_error(full_log)
        return {
            "success": False,
            "video_path": None,
            "stdout": stdout,
            "stderr": stderr,
            "error_summary": error_summary,
            "traceback": tb,
        }

    # Find the generated MP4 file
    mp4_files = list(media_dir.glob("**/*.mp4"))
    if not mp4_files:
        return {
            "success": False,
            "video_path": None,
            "stdout": stdout,
            "stderr": stderr,
            "error_summary": "Render succeeded but no .mp4 file was generated.",
            "traceback": stdout,
        }

    # Select the largest or latest MP4
    mp4_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    generated_mp4 = mp4_files[0]

    final_target = job_dir / "raw_reel.mp4"
    shutil.copy2(generated_mp4, final_target)
    logger.info(f"Render successful! Video saved to {final_target}")

    return {
        "success": True,
        "video_path": str(final_target),
        "stdout": stdout,
        "stderr": stderr,
        "error_summary": None,
        "traceback": None,
    }

def extract_manim_error(log: str) -> Tuple[str, str]:
    """
    Extract meaningful traceback and error message from Manim output.
    """
    lines = log.splitlines()
    tb_lines = []
    recording_tb = False

    for line in lines:
        if "Traceback (most recent call last):" in line:
            recording_tb = True
            tb_lines = [line]
        elif recording_tb:
            tb_lines.append(line)
            if re.match(r"^[A-Z][a-zA-Z0-9_]*Error:", line) or re.match(r"^[A-Z][a-zA-Z0-9_]*Exception:", line):
                break

    if tb_lines:
        tb_text = "\n".join(tb_lines)
        error_summary = tb_lines[-1] if tb_lines else "Manim Error"
        return error_summary, tb_text

    error_candidates = [l for l in lines if "Error" in l or "Exception" in l]
    if error_candidates:
        summary = error_candidates[-1]
        return summary, "\n".join(lines[-30:])

    return "Unknown Manim Render Error", "\n".join(lines[-30:])
