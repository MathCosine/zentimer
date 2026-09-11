/* Calm study ambience, generated in the browser with Web Audio.
   No audio files and no network — each track is a little machine that never
   repeats itself, so there is no loop point to notice. */
window.Music = (function () {
  'use strict';

  var ctx = null, master = null, analyser = null;
  var playing = false;
  var ducked = false;
  var volume = 0.35;
  var index = 0;
  var nodes = [];        // things to stop when a track ends
  var timers = [];       // scheduled events for the current track

  var TRACKS = [
    { id: 'drift', name: 'drift', note: 'warm chords', start: startDrift },
    { id: 'rain',  name: 'rain',  note: 'soft shower', start: startRain },
    { id: 'bells', name: 'bells', note: 'far away',    start: startBells },
    { id: 'hush',  name: 'hush',  note: 'deep and low', start: startHush }
  ];

  /* ---------- plumbing ---------- */

  function ensure() {
    if (ctx) return ctx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();

    master = ctx.createGain();
    master.gain.value = 0;

    var reverb = ctx.createConvolver();
    reverb.buffer = impulse(3.2, 2.6);
    var wet = ctx.createGain(); wet.gain.value = 0.45;
    var dry = ctx.createGain(); dry.gain.value = 0.75;

    master.connect(dry).connect(ctx.destination);
    master.connect(reverb);
    reverb.connect(wet).connect(ctx.destination);

    analyser = ctx.createAnalyser();       // only so the level can be measured
    analyser.fftSize = 2048;
    master.connect(analyser);
    return ctx;
  }

  function impulse(seconds, decay) {
    var length = Math.floor(ctx.sampleRate * seconds);
    var buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (var channel = 0; channel < 2; channel++) {
      var data = buffer.getChannelData(channel);
      for (var i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  function noise(seconds, brown) {
    var length = Math.floor(ctx.sampleRate * seconds);
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < length; i++) {
      var white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.2; }
      else data[i] = white * 0.8;
    }
    return buffer;
  }

  function osc(type, freq, gainValue, destination) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gainValue;
    o.connect(g).connect(destination || master);
    o.start();
    nodes.push(o);
    return { osc: o, gain: g };
  }

  function loopNoise(brown, destination, gainValue) {
    var source = ctx.createBufferSource();
    source.buffer = noise(4, brown);
    source.loop = true;
    var g = ctx.createGain();
    g.gain.value = gainValue;
    source.connect(g).connect(destination);
    source.start();
    nodes.push(source);
    return g;
  }

  function every(ms, fn) { timers.push(setInterval(fn, ms)); }
  function after(ms, fn) { timers.push(setTimeout(fn, ms)); }

  /* ---------- the tracks ---------- */

  var CHORDS = [
    [220.00, 261.63, 329.63],   // Am
    [174.61, 261.63, 349.23],   // F
    [196.00, 246.94, 293.66],   // G
    [164.81, 220.00, 261.63]    // Em-ish
  ];

  function startDrift() {
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.7;
    filter.connect(master);

    var bed = ctx.createGain();
    bed.gain.value = 0.28;          // levelled against the other tracks
    bed.connect(filter);

    var voices = [];
    for (var i = 0; i < 3; i++) {
      voices.push(osc('sine', CHORDS[0][i], 0.28, bed));
      var shimmer = osc('sine', CHORDS[0][i] * 2.002, 0.05, bed);   // a touch of air
      voices.push(shimmer);
    }

    var sweep = ctx.createOscillator();
    var sweepDepth = ctx.createGain();
    sweep.frequency.value = 0.026;
    sweepDepth.gain.value = 220;
    sweep.connect(sweepDepth).connect(filter.frequency);
    sweep.start();
    nodes.push(sweep);

    var chord = 0;
    every(19000, function () {
      chord = (chord + 1) % CHORDS.length;
      for (var v = 0; v < voices.length; v++) {
        var tone = CHORDS[chord][Math.floor(v / 2)];
        var target = v % 2 ? tone * 2.002 : tone;
        voices[v].osc.frequency.setTargetAtTime(target, ctx.currentTime, 3.5);
      }
    });
  }

  function startRain() {
    var band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 0.45;
    var roof = ctx.createBiquadFilter();
    roof.type = 'lowpass';
    roof.frequency.value = 3200;
    band.connect(roof).connect(master);

    var rain = loopNoise(false, band, 0.26);

    var gusts = ctx.createOscillator();
    var gustDepth = ctx.createGain();
    gusts.frequency.value = 0.055;
    gustDepth.gain.value = 0.045;
    gusts.connect(gustDepth).connect(rain.gain);
    gusts.start();
    nodes.push(gusts);

    osc('sine', 110, 0.05);        // a warm room underneath the weather
    osc('sine', 164.81, 0.03);
  }

  var PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.00];

  function startBells() {
    osc('sine', 130.81, 0.05);
    osc('sine', 196.00, 0.035);

    function ping() {
      var freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
      if (Math.random() < 0.35) freq /= 2;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      var at = ctx.currentTime;
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.19, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 4.5);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + 4.6);
      after(2800 + Math.random() * 5200, ping);
    }
    after(600, ping);
  }

  function startHush() {
    var roof = ctx.createBiquadFilter();
    roof.type = 'lowpass';
    roof.frequency.value = 420;
    roof.connect(master);

    loopNoise(true, roof, 0.22);
    var low = osc('sine', 55, 0.12);
    osc('sine', 82.41, 0.06);

    var swell = ctx.createOscillator();
    var swellDepth = ctx.createGain();
    swell.frequency.value = 0.018;
    swellDepth.gain.value = 0.06;
    swell.connect(swellDepth).connect(low.gain);
    swell.start();
    nodes.push(swell);
  }

  /* ---------- transport ---------- */

  function clear() {
    timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    timers = [];
    nodes.forEach(function (n) { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
    nodes = [];
  }

  function level() { return playing ? volume * (ducked ? 0.22 : 1) : 0; }

  function ramp(seconds) {
    if (!master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(level(), ctx.currentTime, seconds);
  }

  function play() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    if (playing) return true;
    clear();
    playing = true;
    TRACKS[index].start();
    ramp(1.6);
    return true;
  }

  function stop() {
    if (!playing) return;
    playing = false;
    ramp(0.6);
    var stopping = setTimeout(function () {
      clear();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0, ctx.currentTime);
    }, 1400);
    timers.push(stopping);
  }

  return {
    tracks: function () { return TRACKS.map(function (t) { return { id: t.id, name: t.name, note: t.note }; }); },
    isPlaying: function () { return playing; },
    current: function () { return index; },
    volume: function () { return volume; },

    toggle: function () { if (playing) stop(); else play(); return playing; },
    play: play,
    stop: stop,

    select: function (next) {
      index = ((next % TRACKS.length) + TRACKS.length) % TRACKS.length;
      if (playing) {
        // fade out, swap the machine, fade back in
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
        var pending = setTimeout(function () {
          clear();
          TRACKS[index].start();
          ramp(1.4);
        }, 900);
        timers.push(pending);
      }
      return index;
    },

    setVolume: function (value) {
      volume = Math.max(0, Math.min(1, value));
      if (playing) ramp(0.2);
      return volume;
    },

    duck: function (on) {
      ducked = !!on;
      if (playing) ramp(0.25);
    },

    /* what is actually coming out: state, level and the measured signal */
    probe: function () {
      if (!ctx || !analyser) return { state: 'none', gain: 0, voices: 0, rms: 0 };
      var data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i++) sum += data[i] * data[i];
      return {
        state: ctx.state,
        gain: +master.gain.value.toFixed(3),
        voices: nodes.length,
        rms: +Math.sqrt(sum / data.length).toFixed(4)
      };
    },

    restore: function (saved) {
      if (!saved) return;
      if (typeof saved.volume === 'number') volume = Math.max(0, Math.min(1, saved.volume));
      if (typeof saved.track === 'number') index = ((saved.track % TRACKS.length) + TRACKS.length) % TRACKS.length;
    }
  };
})();
