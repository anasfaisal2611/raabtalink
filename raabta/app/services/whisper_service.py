from faster_whisper import WhisperModel
model = WhisperModel("small", device="cpu", compute_type="int8")

def transcribe_audio(file_path:str):

    segments, info = model.transcribe(file_path, beam_size=5, vad_filter=True)

    text = " ".join(seg.text for seg in segments)
    return text.strip()


def transcribe_audio_bytes(raw_pcm: bytes) -> str:
    """Transcribe raw 16kHz mono int16 PCM bytes to text using faster-whisper."""
    import tempfile, os
    import numpy as np
    audio_array = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32) / 32768.0
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
        write(tmp_path, SAMPLE_RATE, audio_array)
    try:
        return transcribe_audio(tmp_path)
    finally:
        os.unlink(tmp_path)


import sounddevice as sd
from scipy.io.wavfile import write
from faster_whisper import WhisperModel





SAMPLE_RATE=16000 #whisper expects 16khz audio
DURATION=5  

def listen_and_transcribe_audio() -> str:
    '''
    Records Audio from microphone for 5 seconds and transcribes it to to text using 
    local whisper model, Use this to capture what the user is asking via voice'''

    print("[Listening.... Speak now]")
    recording=sd.rec(
        int(DURATION*SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16"
    )
    sd.wait()


    write("temp_recording.wav",SAMPLE_RATE,recording)

    
    transcribed_text=transcribe_audio("temp_recording.wav")

    if not transcribed_text:
        return "No Speech detected"


    print(f'[Transcribed: {transcribed_text}]')
    return transcribed_text

