"""
generate_dummies.py — Hackathon 7.0 dummy .tflite generator.

Builds three structurally valid (but untrained, random-weight) .tflite files so
the mobile team can wire up react-native-fast-tflite + the JSI bridge before
the real trained models land from the ML pipeline.

The shapes here are the frozen contract from shared_contracts/. Do NOT change
them without updating shared_contracts/README.md first.

Run from repo root, inside the venv:
    source venv/bin/activate
    python generate_dummies.py
"""

import os
import sys

try:
    import tensorflow as tf
except ImportError:
    sys.stderr.write(
        "TensorFlow is not installed in this Python environment.\n"
        "Activate the project venv first:\n"
        "    source venv/bin/activate\n"
        "    pip install tensorflow numpy\n"
        "    python generate_dummies.py\n"
    )
    sys.exit(1)

OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "mobile_app", "assets", "models",
)
os.makedirs(OUT_DIR, exist_ok=True)


def _convert(model: tf.keras.Model, path: str) -> None:
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    # Default float32 dummy. Real models will be INT8 PTQ at publish time.
    tflite_bytes = converter.convert()
    with open(path, "wb") as f:
        f.write(tflite_bytes)
    size_kb = os.path.getsize(path) / 1024.0
    print(f"  -> {os.path.basename(path)}  ({size_kb:,.1f} KB)")


def build_blazeface_dummy() -> tf.keras.Model:
    """Input [1,128,128,3] -> boxes [1,896,16], scores [1,896,1]."""
    inp = tf.keras.Input(shape=(128, 128, 3), name="image")
    x = tf.keras.layers.Conv2D(8, 3, strides=2, padding="same", activation="relu")(inp)
    x = tf.keras.layers.Conv2D(16, 3, strides=2, padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)

    boxes = tf.keras.layers.Dense(896 * 16)(x)
    boxes = tf.keras.layers.Reshape((896, 16), name="boxes")(boxes)

    scores = tf.keras.layers.Dense(896 * 1)(x)
    scores = tf.keras.layers.Reshape((896, 1), name="scores")(scores)

    return tf.keras.Model(inp, [boxes, scores], name="blazeface_dummy")


def build_shufflenet_dummy() -> tf.keras.Model:
    """Input [1,112,112,3] -> [1,2] softmax (live vs spoof)."""
    inp = tf.keras.Input(shape=(112, 112, 3), name="image")
    x = tf.keras.layers.Conv2D(8, 3, strides=2, padding="same", activation="relu")(inp)
    x = tf.keras.layers.Conv2D(16, 3, strides=2, padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    out = tf.keras.layers.Dense(2, activation="softmax", name="liveness")(x)
    return tf.keras.Model(inp, out, name="shufflenet_dummy")


def build_mobilefacenet_dummy() -> tf.keras.Model:
    """Input [1,112,112,3] -> [1,512] embedding."""
    inp = tf.keras.Input(shape=(112, 112, 3), name="image")
    x = tf.keras.layers.Conv2D(8, 3, strides=2, padding="same", activation="relu")(inp)
    x = tf.keras.layers.Conv2D(16, 3, strides=2, padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    out = tf.keras.layers.Dense(512, name="embedding")(x)
    return tf.keras.Model(inp, out, name="mobilefacenet_dummy")


def main() -> None:
    print(f"TensorFlow {tf.__version__}")
    print(f"Writing dummy .tflite files to: {OUT_DIR}\n")

    _convert(build_blazeface_dummy(),
             os.path.join(OUT_DIR, "blazeface_dummy.tflite"))
    _convert(build_shufflenet_dummy(),
             os.path.join(OUT_DIR, "shufflenet_dummy.tflite"))
    _convert(build_mobilefacenet_dummy(),
             os.path.join(OUT_DIR, "mobilefacenet_dummy.tflite"))

    print("\nDone. Dummies are structurally valid but untrained.")
    print("Shapes match shared_contracts/README.md.")


if __name__ == "__main__":
    main()
