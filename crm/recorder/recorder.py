"""Dual-channel call recorder for Dara Clean — manager mic + client loopback.

Captures TWO separate mono streams (near-end microphone = manager, far-end
WASAPI loopback of the headset output = client) so that overlapping speech
stays separable. On a normal mono recording, when both talk at once one voice
is lost; here each speaker is on its own channel.

Output: two 16 kHz mono WAV files per call, named
    YYYYMMDD-HHMMSS__manager.wav
    YYYYMMDD-HHMMSS__client.wav
dropped into the sync folder (default: "Record call/").

Stack: Python 3.11 + pyaudiowpatch (WASAPI). Requires a HEADSET on the manager
(closed output) so the client's voice does not bleed into the mic.

Usage:
    python recorder.py --out "../Record call" --seconds 0      # record until Ctrl+C
    python recorder.py --out "../Record call" --seconds 13     # fixed duration (for tests)
"""

import argparse
import audioop
import datetime
import os
import threading
import time
import wave

import pyaudiowpatch as pyaudio

TARGET_RATE = 16000
CHUNK = 1024


def find_devices(p):
    """Default mic (manager) + loopback of the default output (client)."""
    wasapi = p.get_host_api_info_by_type(pyaudio.paWASAPI)
    out = p.get_device_info_by_index(wasapi["defaultOutputDevice"])
    loopback = next(
        (d for d in p.get_loopback_device_info_generator() if out["name"] in d["name"]),
        None,
    )
    mic = p.get_default_input_device_info()
    return mic, loopback


class ChannelCapture(threading.Thread):
    """Reads one WASAPI stream into memory until stopped (or max_frames reached)."""

    def __init__(self, audio, device, max_frames=None):
        super().__init__(daemon=True)
        self.audio = audio
        self.device = device
        self.rate = int(device["defaultSampleRate"])
        self.channels = int(device["maxInputChannels"])
        self.max_frames = max_frames
        self.frames = []
        self._stop_event = threading.Event()

    def run(self):
        stream = self.audio.open(
            format=pyaudio.paInt16,
            channels=self.channels,
            rate=self.rate,
            input=True,
            input_device_index=self.device["index"],
            frames_per_buffer=CHUNK,
        )
        reads = 0
        while not self._stop_event.is_set():
            self.frames.append(stream.read(CHUNK, exception_on_overflow=False))
            reads += 1
            if self.max_frames is not None and reads >= self.max_frames:
                break
        stream.stop_stream()
        stream.close()

    def stop(self):
        self._stop_event.set()

    def write_mono_16k(self, path):
        """Downmix to mono + resample to 16 kHz and write a WAV. Returns RMS level."""
        data = b"".join(self.frames)
        if not data:
            data = b"\x00\x00"
        if self.channels == 2:
            data = audioop.tomono(data, 2, 0.5, 0.5)
        if self.rate != TARGET_RATE:
            data, _ = audioop.ratecv(data, 2, 1, self.rate, TARGET_RATE, None)
        with wave.open(path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(TARGET_RATE)
            wf.writeframes(data)
        return audioop.rms(data, 2)


def record(out_dir, seconds=0):
    """Record manager + client channels concurrently into two WAV files."""
    os.makedirs(out_dir, exist_ok=True)
    audio = pyaudio.PyAudio()
    mic, loopback = find_devices(audio)
    if loopback is None:
        audio.terminate()
        raise RuntimeError("WASAPI loopback устройство не найдено (нет вывода по умолчанию?)")
    print(f"менеджер (микрофон): {mic['name']}")
    print(f"клиент (loopback):   {loopback['name']}")

    max_mic = int(mic["defaultSampleRate"] / CHUNK * seconds) if seconds else None
    max_lb = int(loopback["defaultSampleRate"] / CHUNK * seconds) if seconds else None
    cap_mic = ChannelCapture(audio, mic, max_mic)
    cap_client = ChannelCapture(audio, loopback, max_lb)
    cap_mic.start()
    cap_client.start()

    if seconds:
        cap_mic.join()
        cap_client.join()
    else:
        print(">> Запись... Ctrl+C для остановки.")
        try:
            while cap_mic.is_alive():
                time.sleep(0.3)
        except KeyboardInterrupt:
            cap_mic.stop()
            cap_client.stop()
            cap_mic.join()
            cap_client.join()

    audio.terminate()
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.join(out_dir, ts)
    rms_m = cap_mic.write_mono_16k(base + "__manager.wav")
    rms_c = cap_client.write_mono_16k(base + "__client.wav")
    print(f"[OK] {ts}__manager.wav (уровень={rms_m})")
    print(f"[OK] {ts}__client.wav  (уровень={rms_c})")
    return base


def _open_input(audio, dev):
    return audio.open(
        format=pyaudio.paInt16,
        channels=int(dev["maxInputChannels"]),
        rate=int(dev["defaultSampleRate"]),
        input=True,
        input_device_index=dev["index"],
        frames_per_buffer=CHUNK,
    )


def _write_mono_16k(path, frames, rate, channels):
    data = b"".join(frames) or b"\x00\x00"
    if channels == 2:
        data = audioop.tomono(data, 2, 0.5, 0.5)
    if rate != TARGET_RATE:
        data, _ = audioop.ratecv(data, 2, 1, rate, TARGET_RATE, None)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(TARGET_RATE)
        wf.writeframes(data)


def _finalize_call(out_dir, mic_buf, lb_buf, mic, lb, min_call_sec):
    """Write one detected call to two mono WAVs. Returns True if written."""
    dur = len(lb_buf) * CHUNK / int(lb["defaultSampleRate"])
    if dur < min_call_sec:
        return False
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.join(out_dir, ts)
    _write_mono_16k(base + "__manager.wav", mic_buf, int(mic["defaultSampleRate"]), int(mic["maxInputChannels"]))
    _write_mono_16k(base + "__client.wav", lb_buf, int(lb["defaultSampleRate"]), int(lb["maxInputChannels"]))
    print(f"[OK] записан звонок: {ts}__manager/client.wav ({dur:.0f}s)")
    return True


def watch(out_dir, start_rms=350, silence_rms=150, silence_sec=2.5, min_call_sec=3.0, max_calls=None):
    """Daemon: auto-records each call by detecting speech on the client (loopback) channel.

    IDLE -> (loopback level rises) -> REC -> (silence_sec of quiet) -> write 2 files -> IDLE.
    """
    os.makedirs(out_dir, exist_ok=True)
    audio = pyaudio.PyAudio()
    mic, loopback = find_devices(audio)
    if loopback is None:
        audio.terminate()
        raise RuntimeError("WASAPI loopback устройство не найдено")
    ms, ls = _open_input(audio, mic), _open_input(audio, loopback)
    chunk_sec = CHUNK / int(loopback["defaultSampleRate"])
    print(f"менеджер: {mic['name']} | клиент: {loopback['name']}")
    print(">> Слежу за звонками... Ctrl+C для выхода.")
    state, mic_buf, lb_buf, silence, calls = "IDLE", [], [], 0.0, 0
    try:
        while True:
            m = ms.read(CHUNK, exception_on_overflow=False)
            l = ls.read(CHUNK, exception_on_overflow=False)
            level = audioop.rms(l, 2)
            if state == "IDLE":
                if level > start_rms:
                    state, mic_buf, lb_buf, silence = "REC", [m], [l], 0.0
                continue
            mic_buf.append(m)
            lb_buf.append(l)
            silence = silence + chunk_sec if level < silence_rms else 0.0
            if silence < silence_sec:
                continue
            if _finalize_call(out_dir, mic_buf, lb_buf, mic, loopback, min_call_sec):
                calls += 1
                if max_calls and calls >= max_calls:
                    break
            state, mic_buf, lb_buf, silence = "IDLE", [], [], 0.0
    except KeyboardInterrupt:
        pass
    finally:
        for s in (ms, ls):
            s.stop_stream()
            s.close()
        audio.terminate()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../Record call", help="папка для файлов")
    ap.add_argument("--watch", action="store_true", help="демон: авто-запись каждого звонка")
    ap.add_argument("--seconds", type=int, default=0, help="ручной режим: 0=до Ctrl+C, иначе фикс. длит.")
    args = ap.parse_args()
    if args.watch:
        watch(args.out)
    else:
        record(args.out, args.seconds)
