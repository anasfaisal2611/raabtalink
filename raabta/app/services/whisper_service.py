from faster_whisper import WhisperModel
from scipy.io.wavfile import write

SAMPLE_RATE = 16000
DURATION = 5
WHISPER_LANGUAGE = "ur"
URDU_PROMPT = "یہ پاکستان میں اردو زبان میں ہنگامی اپیل ہے۔"

_model = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel("small", device="cpu", compute_type="int8")
    return _model


def transcribe_audio(file_path: str) -> str:
    segments, _info = _get_model().transcribe(
        file_path,
        beam_size=5,
        vad_filter=True,
        language=WHISPER_LANGUAGE,
        initial_prompt=URDU_PROMPT,
    )
    text = " ".join(seg.text for seg in segments)
    return text.strip()


def transcribe_audio_bytes(raw_pcm: bytes) -> str:
    """Transcribe raw 16kHz mono int16 PCM bytes to text using faster-whisper."""
    import os
    import tempfile

    import numpy as np

    audio_array = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32) / 32768.0
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
        write(tmp_path, SAMPLE_RATE, audio_array)
    try:
        return transcribe_audio(tmp_path)
    finally:
        os.unlink(tmp_path)


def listen_and_transcribe_audio() -> str:
    """Record 5 seconds from the mic and transcribe in Urdu (local dev only)."""
    import sounddevice as sd

    print("[Listening.... Speak now]")
    recording = sd.rec(
        int(DURATION * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
    )
    sd.wait()

    write("temp_recording.wav", SAMPLE_RATE, recording)
    transcribed_text = transcribe_audio("temp_recording.wav")

    if not transcribed_text:
        return "No Speech detected"

    print(f"[Transcribed: {transcribed_text}]")
    return transcribed_text
