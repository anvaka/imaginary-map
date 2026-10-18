# Finds the main face in every image of a map of people with OpenCV's YuNet and
# writes faceBoxes.json: { "<image url>": [[x, y, w, h], ...] } in fractions of
# the whole image, one box per Midjourney quadrant that has a face.
#
# Usage: python detect_faces.py <public dir> <yunet.onnx> <faceBoxes.json> [map ...]
# Maps are folders under public/images-small/ (e.g. cyberpunk). Without maps,
# every map of people is redone; with them, only those are, and the other
# entries in the file are kept.
#
# corrections.json next to this script has boxes checked by hand where the
# detector picks something else or nothing: { "<image url>": { "boxes":
# [[x, y, w, h], ...], "why": "..." } }. Each box replaces the detected one in
# its quadrant. A quadrant can be marked as having no face with "none":
# [quadrant, ...].
import json
import sys
from pathlib import Path

import cv2

# Maps whose images are about a person; the others cover their country whole
PEOPLE_MAPS = ["cyberpunk"]
public, model_path, out_path = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
SCORE = 0.82

detector = cv2.FaceDetectorYN.create(model_path, "", (320, 320), SCORE, 0.3, 50)
corrections = json.loads((Path(__file__).parent / "corrections.json").read_text())


def detect(img):
    """Best face as [x, y, w, h] in fractions of img, or None."""
    h, w = img.shape[:2]
    best = None
    # Several input sizes: big close-up faces are missed at full resolution
    for size in (320, 640, 1024):
        scale = size / max(w, h)
        small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        detector.setInputSize((small.shape[1], small.shape[0]))
        _, faces = detector.detect(small)
        if faces is None:
            continue
        for f in faces:
            x, y, fw, fh, score = f[0] / scale, f[1] / scale, f[2] / scale, f[3] / scale, float(f[14])
            # Prefer big, confident faces: the subject, not people in the background
            rank = score * fw * fh
            if best is None or rank > best[0]:
                best = (rank, [float(x / w), float(y / h), float(fw / w), float(fh / h)])
    if not best:
        return None
    x, y, fw, fh = best[1]
    x0, y0 = max(0.0, x), max(0.0, y)
    return [x0, y0, min(1.0, x + fw) - x0, min(1.0, y + fh) - y0]


maps = sys.argv[4:] or PEOPLE_MAPS
boxes = json.loads(out_path.read_text()) if sys.argv[4:] and out_path.exists() else {}
for name in maps:
    found = total = corrected = 0
    misses = []
    for path in sorted((public / "images-small" / name).glob("*.webp")):
        url = f"images-small/{name}/{path.name}"
        img = cv2.imread(str(path))
        height, width = img.shape[:2]
        cell_w, cell_h = width // 2, height // 2
        found_here = []
        fixes = corrections.get(url, {})
        for cell in range(4):
            cx, cy = cell % 2, cell // 2
            total += 1
            if cell in fixes.get("none", []):
                corrected += 1
                continue
            fix = next((b for b in fixes.get("boxes", []) if int((b[0] + b[2] / 2) * 2) == cx and int((b[1] + b[3] / 2) * 2) == cy), None)
            if fix:
                corrected += 1
                found_here.append(fix)
                continue
            box = detect(img[cy * cell_h:(cy + 1) * cell_h, cx * cell_w:(cx + 1) * cell_w])
            if not box:
                misses.append(f"{path.stem} quadrant {cell}")
                continue
            found += 1
            x, y, w, h = box
            found_here.append([round((cx + x) / 2, 3), round((cy + y) / 2, 3), round(w / 2, 3), round(h / 2, 3)])
        boxes[url] = found_here
    print(f"{name}: found {found} of {total} faces, {corrected} set by hand" + (f"; none in: {', '.join(misses)}" if misses else ""))

out_path.write_text(json.dumps(dict(sorted(boxes.items())), separators=(",", ":")))
