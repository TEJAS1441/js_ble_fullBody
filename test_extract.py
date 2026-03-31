import torch
import torchaudio

# If we can't extract, we must create a proxy or check if the Kokoro author
# provided a voice extraction script. 
# Looking at https://huggingface.co/hexgrad/Kokoro-82M/blob/main/kokoro.py
# The pipeline loads voices from preset .pt files.
