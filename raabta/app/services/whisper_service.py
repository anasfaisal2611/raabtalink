from faster_whisper import WhisperModel
model = WhisperModel("tiny", device="cpu", compute_type="int8")

def transcribe_audio(file_path:str):

    segments, info = model.transcribe("test_audio.wav", beam_size=1)

    text = " ".join(seg.text for seg in segments)
    return text.strip()