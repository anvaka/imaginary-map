# Face detection

`faceBoxes.json` at the repo root says where the face is in every image of a
map of people (the cyberpunk one), so the map can put the face on land instead
of stretching the image over a country. Images without a face, like the
architecture ones, cover their country instead. It is written once, offline,
whenever a map of people is added:

```sh
python3 -m venv .venv && .venv/bin/pip install opencv-python
curl -LO https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
.venv/bin/python detect_faces.py ../../public face_detection_yunet_2023mar.onnx ../../faceBoxes.json cyberpunk
```

New maps of people go into `PEOPLE_MAPS` in `detect_faces.py`.

The detector (OpenCV YuNet) runs at three input sizes on each of Midjourney's
four candidates and keeps faces scoring 0.82 or more, preferring the biggest.
It misses masks, helmets and veils, and now and then boxes a passer-by or a
light in a street scene. So every map gets checked by eye, and wrong boxes go
into `corrections.json`, which the script applies on every run. A candidate
without a face (a street scene, someone seen from behind) covers its country.

The cyberpunk map needed 35 corrections out of 708 candidates; 616 have a face.
