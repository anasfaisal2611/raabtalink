from faster_whisper import WhisperModel

from faster_whisper import WhisperModel

model = WhisperModel("tiny", device="cpu", compute_type="int8")

segments, info = model.transcribe("test_audio.wav", beam_size=1)

text = " ".join(seg.text for seg in segments)
print(text)