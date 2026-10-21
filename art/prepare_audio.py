"""Download the publicly offered, licensed Foley previews used by sound.js.

No account, original-download endpoint, or API key is used. The project ships
the openly linked high-quality MP3 previews with their source/license record.
"""
from pathlib import Path
import array
import hashlib
import json
import math
import subprocess
import tempfile
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/assets/audio'
SOURCES = [
    dict(key='page', file='page-turn.mp3', title='Page Turn', creator='davidbain',
         source='https://freesound.org/people/davidbain/sounds/136778/',
         download='https://cdn.freesound.org/previews/136/136778_2207512-hq.mp3',
         license='CC0 1.0', license_url='https://creativecommons.org/publicdomain/zero/1.0/',
         recording='Turning a paper page.',
         adaptations='Slower playback, equalization, level, spatial placement, and room reverberation applied at playback.'),
    dict(key='steps', file='footsteps-wood.mp3', title='Footsteps on wood', creator='ChloePieterse',
         source='https://freesound.org/people/ChloePieterse/sounds/764473/',
         download='https://cdn.freesound.org/previews/764/764473_15688677-hq.mp3',
         license='CC0 1.0', license_url='https://creativecommons.org/publicdomain/zero/1.0/',
         recording='Footsteps on wooden flooring, recorded with an Audio Technica AT2020USB microphone.',
         adaptations='Individual footsteps excerpted, with small playback-rate changes, level, spatial placement, and room reverberation.'),
    dict(key='leather', file='leather-creak.mp3', title='Leather Creak / Stretching', creator='IENBA',
         source='https://freesound.org/people/IENBA/sounds/536187/',
         download='https://cdn.freesound.org/previews/536/536187_9616576-hq.mp3',
         license='CC0 1.0', license_url='https://creativecommons.org/publicdomain/zero/1.0/',
         recording='A leather belt twisted and stretched, recorded with Zoom H4n and Sennheiser MKE600.',
         adaptations='Excerpted as leather-bound book Foley, with playback-rate changes, equalization, level, and room reverberation.'),
    dict(key='bus', file='bus-horn.mp3', title='Bus horn short.wav', creator='arundasstp',
         source='https://freesound.org/people/arundasstp/sounds/403980/',
         download='https://cdn.freesound.org/previews/403/403980_7778467-hq.mp3',
         license='CC BY 4.0', license_url='https://creativecommons.org/licenses/by/4.0/',
         recording='A bus horn before the bus moves, recorded in Kozhikode, Kerala, India.',
         adaptations='Low-pass filtering, reduced level, spatial placement outside the entrance, and room reverberation create distance.'),
]

def inspect(path):
    # Core Audio decoding checks the shipped MP3 and supplies PCM for timings.
    with tempfile.TemporaryDirectory(prefix='sundays-audio-') as folder:
        decoded = Path(folder) / 'decoded.wav'
        subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', str(path), str(decoded)], check=True, capture_output=True)
        with wave.open(str(decoded), 'rb') as stream:
            rate = stream.getframerate()
            samples = array.array('h', stream.readframes(stream.getnframes()))
        win = int(rate * .02)
        energy = [math.sqrt(sum(x*x for x in samples[i:i+win]) / max(1, len(samples[i:i+win]))) / 32768 for i in range(0, len(samples), win)]
        # Greedy separated local maxima locate footfall transients, not silence.
        peaks = []
        for i in sorted(range(len(energy)), key=lambda n: energy[n], reverse=True):
            t = i*.02
            if energy[i] > .012 and all(abs(t-p['time']) > .32 for p in peaks):
                peaks.append(dict(time=round(t, 3), rms=round(energy[i], 5)))
            if len(peaks) == 32:
                break
        return dict(duration=round(len(samples)/rate, 4), sample_rate=rate,
                    peak=round(max(abs(x) for x in samples)/32768, 5),
                    decoded=True, energy_peaks=sorted(peaks,key=lambda p:p['time']))

OUT.mkdir(parents=True, exist_ok=True)
for source in SOURCES:
    path = OUT / source['file']
    if not path.exists():
        request = urllib.request.Request(source['download'], headers={'User-Agent':'SundaysAudioPreparation/1.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        path.write_bytes(data)
    source.update(bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), verification=inspect(path))
    print(source['file'], json.dumps(source['verification']))

manifest = dict(verified_on='2026-10-21', transport='Self-hosted copies of public high-quality previews. No third-party audio requests at runtime.',
                synthetic_layers=['Very quiet room air', 'Clock tick', 'Door-bell partials', 'Music-box notes', 'Revelation harmony', 'Room reverberation impulse response'], sources=SOURCES)
(OUT / 'sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Total audio bytes:',sum(s['bytes'] for s in SOURCES))
