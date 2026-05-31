# Bundled Models

These `.tflite` files are loaded by `react-native-fast-tflite` at app startup. They must be present at build time — Android bundles them via `android/app/src/main/assets/`, iOS via the Xcode asset catalog.

## Current Files

| File | Input | Output | Status |
| --- | --- | --- | --- |
| `blazeface_dummy.tflite` | `[1,128,128,3]` | boxes `[1,896,16]`, scores `[1,896,1]` | **Dummy** (random weights) |
| `shufflenet_dummy.tflite` | `[1,112,112,3]` | `[1,2]` softmax | **Dummy** (random weights) |
| `mobilefacenet_dummy.tflite` | `[1,112,112,3]` | `[1,512]` embedding | **Dummy** (random weights) |

The dummies are **structurally valid** — interpreter loads, allocates tensors, runs inference, returns correct-shape garbage. That's enough to bring up the JSI bridge.

## Swapping In Trained Models

The ML pipeline drops trained INT8 `.tflite` files here with the **same filenames and shapes** (drop `_dummy` if you want — just update the import path on the mobile side once). The shapes must match [../../../shared_contracts/](../../../shared_contracts/). No app code change should be required.

## Regenerating Dummies

From repo root:

```bash
source venv/bin/activate
python generate_dummies.py
```
