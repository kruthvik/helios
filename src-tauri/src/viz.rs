//! Audio visualizer: the bands of whatever Windows is playing, read from the output device (WASAPI loopback)
//! and streamed to the UI ~30 times a second. Spotify's own player is DRM-protected, so the page itself can't
//! read its audio. Nothing is recorded or kept: each slice of sound becomes 48 numbers and is gone.

use std::{
    f32::consts::PI,
    sync::{Mutex, mpsc},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{State, ipc::Channel};

pub const BANDS: usize = 48;
const N: usize = 2048; // FFT size: ~43ms of sound at 48kHz, ~23Hz per bin (fine enough to split the bass)

#[derive(Default)]
pub struct Viz(Mutex<Option<mpsc::Sender<()>>>);

/// Starts (or restarts) capture; bands arrive on `on_bands` as 0..=255 per band, low to high.
#[tauri::command]
pub fn viz_start(state: State<Viz>, on_bands: Channel<Vec<u8>>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(stop) = slot.take() {
        let _ = stop.send(());
    }
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    // the stream lives on its own thread (cpal streams can't move between threads) until told to stop
    std::thread::spawn(move || {
        let open = || -> Result<cpal::Stream, String> {
            let device = cpal::default_host()
                .default_output_device()
                .ok_or("no audio output device")?;
            let cfg = device.default_output_config().map_err(|e| e.to_string())?;
            if cfg.sample_format() != cpal::SampleFormat::F32 {
                return Err(format!("unsupported sample format {}", cfg.sample_format()));
            }
            let channels = cfg.channels() as usize;
            let mut an = Analyzer::new(cfg.sample_rate().0 as f32);
            // an input stream on an output device is a loopback capture on WASAPI
            let stream = device
                .build_input_stream(
                    &cfg.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        an.push(data, channels, |b| drop(on_bands.send(b)))
                    },
                    |e| eprintln!("visualizer: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())?;
            stream.play().map_err(|e| e.to_string())?;
            Ok(stream)
        };
        match open() {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                let _ = stop_rx.recv(); // also returns when the sender is dropped
                drop(stream);
            }
            Err(e) => drop(ready_tx.send(Err(e))),
        }
    });
    ready_rx.recv().map_err(|e| e.to_string())??;
    *slot = Some(stop_tx);
    Ok(())
}

#[tauri::command]
pub fn viz_stop(state: State<Viz>) {
    let Ok(mut slot) = state.0.lock() else { return };
    if let Some(stop) = slot.take() {
        let _ = stop.send(());
    }
}

struct Analyzer {
    ring: Vec<f32>,
    pos: usize,
    fresh: usize,
    hop: usize,
    window: Vec<f32>,
    edges: Vec<usize>, // FFT bin where each band starts (BANDS + 1 entries)
    re: Vec<f32>,
    im: Vec<f32>,
    silent: bool,
}

impl Analyzer {
    fn new(rate: f32) -> Self {
        let bin = |hz: f32| ((hz / rate * N as f32).round() as usize).clamp(1, N / 2);
        let (lo, hi) = (50f32, 16_000f32.min(rate / 2.0));
        // log-spaced, so each octave gets its fair share; every band at least one bin wide
        let mut edges: Vec<usize> = (0..=BANDS)
            .map(|i| bin(lo * (hi / lo).powf(i as f32 / BANDS as f32)))
            .collect();
        for i in 1..edges.len() {
            edges[i] = edges[i].max(edges[i - 1] + 1).min(N / 2);
        }
        Analyzer {
            ring: vec![0.0; N],
            pos: 0,
            fresh: 0,
            hop: (rate / 30.0) as usize, // 30 readings a second: the page eases between them on every frame
            window: (0..N)
                .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / N as f32).cos())
                .collect(),
            edges,
            re: vec![0.0; N],
            im: vec![0.0; N],
            silent: true,
        }
    }

    fn push(&mut self, data: &[f32], channels: usize, mut send: impl FnMut(Vec<u8>)) {
        for frame in data.chunks(channels.max(1)) {
            self.ring[self.pos] = frame.iter().sum::<f32>() / frame.len() as f32;
            self.pos = (self.pos + 1) % N;
            self.fresh += 1;
            if self.fresh >= self.hop {
                self.fresh = 0;
                // Once the whole window is exactly zero, its spectrum cannot change. Keep the hop clock
                // and ring position advancing so the first returning sound has precisely the same timing.
                if self.silent && self.ring.iter().all(|&v| v == 0.0) {
                    continue;
                }
                let bands = self.bands();
                let silent = bands.iter().all(|&b| b == 0);
                if !(silent && self.silent) {
                    send(bands.to_vec()); // nothing playing: one all-zero message, then quiet
                }
                self.silent = silent;
            }
        }
    }

    fn bands(&mut self) -> [u8; BANDS] {
        for i in 0..N {
            self.re[i] = self.ring[(self.pos + i) % N] * self.window[i];
            self.im[i] = 0.0;
        }
        fft(&mut self.re, &mut self.im);
        std::array::from_fn(|b| {
            let (a, z) = (self.edges[b], self.edges[b + 1].max(self.edges[b] + 1));
            let peak = (a..z.min(N / 2))
                .map(|k| self.re[k].hypot(self.im[k]))
                .fold(0.0, f32::max);
            // to dB against a full-scale sine, tilted up toward the treble (music has far less energy there)
            let db = 20.0 * (peak / (N as f32 / 4.0)).max(1e-9).log10()
                + 9.0 * (b as f32 / BANDS as f32);
            (((db + 62.0) / 56.0).clamp(0.0, 1.0) * 255.0) as u8
        })
    }
}

/// In-place radix-2 FFT (length must be a power of two).
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * PI / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let (tr, ti) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                (cr, ci) = (cr * wr - ci * wi, cr * wi + ci * wr);
            }
        }
        len <<= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_silence_does_not_run_the_fft() {
        let mut an = Analyzer::new(48_000.0);
        an.re.fill(123.0);
        an.im.fill(456.0);
        let mut messages = 0;
        an.push(&vec![0.0; 48_000], 1, |_| messages += 1);
        assert_eq!(messages, 0);
        assert!(an.re.iter().all(|&v| v == 123.0));
        assert!(an.im.iter().all(|&v| v == 456.0));
    }

    #[test]
    fn optimized_analysis_matches_the_original_message_stream() {
        // Reference path deliberately analyzes every hop, as the original implementation did.
        fn reference_push(
            an: &mut Analyzer,
            data: &[f32],
            channels: usize,
            out: &mut Vec<Vec<u8>>,
        ) {
            for frame in data.chunks(channels.max(1)) {
                an.ring[an.pos] = frame.iter().sum::<f32>() / frame.len() as f32;
                an.pos = (an.pos + 1) % N;
                an.fresh += 1;
                if an.fresh >= an.hop {
                    an.fresh = 0;
                    let bands = an.bands();
                    let silent = bands.iter().all(|&b| b == 0);
                    if !(silent && an.silent) {
                        out.push(bands.to_vec());
                    }
                    an.silent = silent;
                }
            }
        }
        for rate in [44_100.0, 48_000.0, 96_000.0] {
            for channels in [1, 2, 6] {
                let mut optimized = Analyzer::new(rate);
                let mut reference = Analyzer::new(rate);
                let mut actual = Vec::new();
                let mut expected = Vec::new();
                for (frames, amplitude, hz) in [
                    (4096, 0.0, 100.0),
                    (8192, 0.5, 100.0),
                    (6144, 0.0, 100.0),
                    (8192, 0.3, 1000.0),
                    (4096, 1e-8, 8000.0),
                    (6144, 0.0, 100.0),
                ] {
                    let data: Vec<f32> = (0..frames * channels)
                        .map(|i| amplitude * (2.0 * PI * hz * (i / channels) as f32 / rate).sin())
                        .collect();
                    optimized.push(&data, channels, |b| actual.push(b));
                    reference_push(&mut reference, &data, channels, &mut expected);
                    assert_eq!(actual, expected, "rate {rate}, channels {channels}");
                    assert_eq!(optimized.pos, reference.pos);
                    assert_eq!(optimized.fresh, reference.fresh);
                }
            }
        }
    }

    #[test]
    fn a_tone_lights_its_own_band() {
        let rate = 48_000.0;
        let mut an = Analyzer::new(rate);
        let tone = |hz: f32| {
            (0..8192)
                .map(|i| 0.5 * (2.0 * PI * hz * i as f32 / rate).sin())
                .collect::<Vec<_>>()
        };
        for hz in [100.0, 1_000.0, 8_000.0] {
            let mut last = vec![];
            an.push(&tone(hz), 1, |b| last = b);
            let loudest = (0..BANDS).max_by_key(|&i| last[i]).unwrap();
            let bin = (hz / rate * N as f32).round() as usize;
            let band = (0..BANDS)
                .find(|&b| an.edges[b] <= bin && bin < an.edges[b + 1])
                .unwrap();
            assert!(
                loudest.abs_diff(band) <= 1,
                "{hz}Hz peaked in band {loudest}, expected {band}"
            );
            assert!(last.iter().max().unwrap() > &200, "{hz}Hz too quiet");
        }
        // silence: the tone's tail fades out of the window, then one all-zero frame, then nothing more
        let mut sent = vec![];
        an.push(&vec![0.0; 16384], 1, |b| sent.push(b));
        assert!(
            sent.len() <= N / an.hop + 2,
            "kept sending during silence: {}",
            sent.len()
        );
        assert!(sent.last().unwrap().iter().all(|&b| b == 0));
    }
}
