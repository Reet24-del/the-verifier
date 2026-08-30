from pathlib import Path
import math
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

W, H, FPS, SECONDS = 1920, 1080, 15, 180
ORANGE, INK, CREAM, GREEN = "#f4773b", "#171719", "#f3eee6", "#6ba889"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
SERIF = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def wrapped(draw, text, xy, max_width, fnt, fill, spacing=12):
    words, lines, current = text.split(), [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=fnt)[2] <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    draw.multiline_text(xy, "\n".join(lines), font=fnt, fill=fill, spacing=spacing)


def header(draw, step, color):
    draw.rounded_rectangle((72, 46, 112, 89), 8, outline=color, width=3)
    draw.text((83, 51), "V", font=font(BOLD, 24), fill=color)
    draw.text((130, 54), "THE VERIFIER", font=font(BOLD, 24), fill=color)
    draw.text((1680, 57), step, font=font(BOLD, 22), fill=color)


def caption(img, text):
    draw = ImageDraw.Draw(img)
    fnt = font(BOLD, 31)
    box = draw.textbbox((0, 0), text, font=fnt)
    width = min(1640, box[2] - box[0] + 64)
    left = (W - width) // 2
    draw.rounded_rectangle((left, 976, left + width, 1044), 18, fill=(23, 23, 25, 238))
    draw.text((W // 2, 1010), text, font=fnt, fill="white", anchor="mm")


def title(draw, kicker, heading, body, color=INK, accent=INK):
    draw.text((80, 150), kicker, font=font(BOLD, 24), fill=accent)
    wrapped(draw, heading, (80, 205), 1080, font(SERIF, 78), color, 4)
    wrapped(draw, body, (80, 445), 960, font(REGULAR, 36), color, 10)


def scene_landing():
    return Image.open(PUBLIC / "landing.png").convert("RGB").resize((W, H))


def scene_brief():
    img = Image.new("RGB", (W, H), CREAM); d = ImageDraw.Draw(img); header(d, "01 / 06", INK)
    title(d, "SPOKEN OR TYPED BRIEF", "Start with one clear claim.", "Type it—or speak naturally and keep the same conversational context.")
    d.rounded_rectangle((80, 730, 1840, 915), 28, fill="white", outline=INK, width=3)
    d.text((120, 790), "Verify that Brian Niccol is CEO of Starbucks.", font=font(BOLD, 40), fill=INK)
    d.rounded_rectangle((1535, 777, 1788, 855), 16, fill=INK)
    d.text((1662, 816), "●  LISTENING", anchor="mm", font=font(BOLD, 23), fill="white")
    caption(img, "Speak once, then continue asking follow-up questions without restarting.")
    return img


def evidence_card(d, box, bg, label, headline, source, verdict):
    x1, y1, x2, y2 = box
    d.rounded_rectangle(box, 26, fill=bg, outline=INK, width=3)
    d.text((x1 + 34, y1 + 30), label, font=font(BOLD, 22), fill=INK)
    wrapped(d, headline, (x1 + 34, y1 + 90), x2 - x1 - 68, font(SERIF, 48), INK, 4)
    d.text((x1 + 34, y2 - 115), source, font=font(REGULAR, 26), fill=INK)
    d.text((x1 + 34, y2 - 66), verdict, font=font(BOLD, 23), fill=INK)


def scene_research():
    img = Image.new("RGB", (W, H), ORANGE); d = ImageDraw.Draw(img); header(d, "02 / 06", INK)
    title(d, "OPPOSING EVIDENCE LANES", "Search for support—and contradiction.", "Both lanes stay visible, so a polished answer cannot hide disagreement.")
    evidence_card(d, (80, 590, 930, 925), "#dbeee5", "SUPPORT ANGLE", "Brian Niccol is chairman and CEO.", "Starbucks leadership page · Current", "+ SUPPORTS CLAIM")
    evidence_card(d, (990, 590, 1840, 925), "#ffe0d4", "CHALLENGE ANGLE", "Laxman Narasimhan was named CEO.", "Starbucks announcement · Older", "! PUBLIC CONTRADICTION")
    caption(img, "Two real public sources. Two apparently conflicting claims.")
    return img


def scene_resolve():
    img = Image.new("RGB", (W, H), INK); d = ImageDraw.Draw(img); header(d, "03 / 06", CREAM)
    title(d, "STRUCTURED DATE METADATA", "The newer evidence wins for a reason you can inspect.", "Raw values are preserved, normalized to UTC, and used deterministically.", CREAM, ORANGE)
    d.rounded_rectangle((1300, 155, 1800, 220), 30, fill=GREEN)
    d.text((1550, 188), "CURRENT CLAIM SUPPORTED", anchor="mm", font=font(BOLD, 22), fill=INK)
    cols = [100, 650, 970, 1240]
    headers = ["SOURCE", "FIELD", "RAW VALUE", "NORMALIZED (UTC)"]
    for x, text in zip(cols, headers): d.text((x, 665), text, font=font(BOLD, 21), fill=ORANGE)
    rows = [("Current leadership page", "dateModified", "2026-08-22", "2026-08-22T00:00:00Z"), ("CEO announcement", "datePublished", "2023-03-20", "2023-03-20T00:00:00Z")]
    for i, row in enumerate(rows):
        y = 720 + i * 92
        d.rounded_rectangle((80, y - 18, 1840, y + 60), 12, fill="#302d2a" if i == 0 else "#242427")
        for x, text in zip(cols, row): d.text((x, y), text, font=font(REGULAR, 26), fill=CREAM)
    caption(img, "The conflict is resolved by dates—not by whichever sentence sounds stronger.")
    return img


def scene_inspect():
    img = Image.new("RGB", (W, H), CREAM); d = ImageDraw.Draw(img); header(d, "04 / 06", INK)
    title(d, "EVIDENCE-GROUNDED CHAT", "Keep asking without losing context.", "Sources, normalized dates, and resolution stay active throughout the conversation.")
    d.rounded_rectangle((1040, 555, 1825, 910), 28, fill="white", outline=INK, width=3)
    d.text((1080, 595), "FOLLOW-UP", font=font(BOLD, 22), fill=INK)
    wrapped(d, "Why was the older CEO announcement rejected?", (1080, 650), 680, font(BOLD, 36), INK, 6)
    d.rounded_rectangle((1080, 775, 1785, 875), 18, fill="#f1e9df")
    wrapped(d, "Its publication date predates the current leadership evidence.", (1105, 798), 650, font(REGULAR, 27), INK, 5)
    caption(img, "Inspect the reasoning, open the sources, and continue the investigation.")
    return img


def scene_approval(approved=False):
    img = Image.new("RGB", (W, H), ORANGE); d = ImageDraw.Draw(img); header(d, "05 / 06", INK)
    title(d, "SERVER-ENFORCED APPROVAL", "Research is not permission to save.", "A one-time token gates persistence. Export stays locked until the server confirms approval.")
    d.rounded_rectangle((1110, 310, 1785, 875), 32, fill=CREAM, outline=INK, width=3)
    d.text((1448, 425), "APPROVED" if approved else "LOCKED", anchor="mm", font=font(BOLD, 38), fill=GREEN if approved else INK)
    d.text((1448, 535), "Dossier saved" if approved else "Save this verified brief?", anchor="mm", font=font(SERIF, 45), fill=INK)
    d.text((1448, 625), "Server-confirmed approval received." if approved else "Nothing is persisted until you decide.", anchor="mm", font=font(REGULAR, 25), fill=INK)
    d.rounded_rectangle((1210, 705, 1685, 790), 16, fill=GREEN if approved else INK)
    d.text((1448, 748), "EXPORT DOSSIER" if approved else "APPROVE & SAVE", anchor="mm", font=font(BOLD, 27), fill=INK if approved else "white")
    caption(img, "Approval confirmed. Persistence and export are enabled." if approved else "Without explicit approval, the server refuses to save.")
    return img


def scene_export():
    img = Image.new("RGB", (W, H), CREAM); d = ImageDraw.Draw(img); header(d, "06 / 06", INK)
    title(d, "AUDITABLE OUTPUT", "A dossier you can actually defend.", "Claim, source URLs, evidence roles, raw dates, normalized dates, resolution, and approval checkpoint.")
    items = ["Original claim", "Opposing sources", "Date metadata", "Resolution logic", "Approval proof", "Export record"]
    for i, text in enumerate(items):
        x, y = 1120 + (i % 2) * 345, 545 + (i // 2) * 120
        d.rounded_rectangle((x, y, x + 315, y + 88), 16, fill=INK if i == 5 else "white", outline=INK, width=2)
        d.text((x + 22, y + 28), f"+ {text}", font=font(BOLD, 24), fill="white" if i == 5 else INK)
    caption(img, "An inspectable audit trail for decisions that matter.")
    return img


def scene_close():
    img = Image.new("RGB", (W, H), INK); d = ImageDraw.Draw(img)
    d.text((W // 2, 210), "THE VERIFIER", anchor="mm", font=font(BOLD, 26), fill=ORANGE)
    d.multiline_text((W // 2, 430), "Verify first.\nSave only when you are ready.", anchor="mm", align="center", font=font(SERIF, 94), fill=CREAM, spacing=8)
    d.text((W // 2, 680), "Evidence first. Approval always.", anchor="mm", font=font(REGULAR, 36), fill=CREAM)
    d.rounded_rectangle((460, 760, 1460, 840), 18, fill=ORANGE)
    d.text((W // 2, 800), "github.com/Reet24-del/the-verifier", anchor="mm", font=font(BOLD, 28), fill=INK)
    caption(img, "The Verifier shows the evidence, explains the conflict, and waits for approval.")
    return img


def render():
    base = [scene_landing(), scene_brief(), scene_research(), scene_resolve(), scene_inspect(), scene_approval(False), scene_export(), scene_close()]
    durations = [18, 20, 25, 30, 21, 26, 20, 20]
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    silent = OUT / "verifier-demo-silent.mp4"
    cmd = [ffmpeg, "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-an", "-vcodec", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", str(silent)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frame_index = 0
    for index, seconds in enumerate(durations):
        count = seconds * FPS
        for local in range(count):
            current = base[index]
            if index == 5 and local > count * 0.55:
                current = scene_approval(True)
            scale = 1.0 + 0.018 * (local / max(1, count - 1))
            crop_w, crop_h = int(W / scale), int(H / scale)
            left, top = (W - crop_w) // 2, (H - crop_h) // 2
            frame = current.crop((left, top, left + crop_w, top + crop_h)).resize((W, H), Image.Resampling.LANCZOS)
            fade = min(1.0, local / 8, (count - 1 - local) / 8)
            if fade < 1:
                frame = ImageEnhance.Brightness(frame).enhance(max(0.05, fade))
            proc.stdin.write(frame.tobytes())
            frame_index += 1
            if frame_index % (FPS * 10) == 0:
                print(f"Rendered {frame_index / FPS:.0f}s / {SECONDS}s", flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("Video encoding failed")
    final = OUT / "the-verifier-3-minute-demo.mp4"
    mux = [ffmpeg, "-y", "-i", str(silent), "-i", str(PUBLIC / "voiceover.mp3"), "-filter_complex", "[1:a]apad=pad_dur=2[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", str(SECONDS), "-movflags", "+faststart", str(final)]
    subprocess.run(mux, check=True)
    print(final)


if __name__ == "__main__":
    render()
