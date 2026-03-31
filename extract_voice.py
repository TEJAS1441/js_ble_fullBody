import torch
from kokoro import KPipeline

print("\n--- Inspecting Kokoro voice loading process ---")
pipeline = KPipeline(lang_code="a")

# look at a built-in voice to see the tensor shape
try:
    v = pipeline.load_voice('af_heart')
    print("Voice tensor shape:", v.shape)
    print("Type:", type(v))
except Exception as e:
    print("Error:", e)
