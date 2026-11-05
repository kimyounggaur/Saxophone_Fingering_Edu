// A/B player: clips share one timeline, so switching from one to another continues at the same
// position (with a 20 ms crossfade) instead of starting over.

export interface PlayerClip {
  readonly key: string;
  readonly buffer: AudioBuffer;
  /** Linear gain that matches the clip's loudness with the others. */
  readonly gain: number;
}

interface Playing {
  readonly key: string;
  readonly source: AudioBufferSourceNode;
  readonly fade: GainNode;
  readonly level: GainNode;
}

const FADE_SECONDS = 0.02;

export class ClipPlayer {
  onChange: (() => void) | null = null;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private clips = new Map<string, PlayerClip>();
  private playing: Playing | null = null;
  private startedAt = 0; // context time at which the clip's position 0 would have started
  private volume = 0.85;
  private loopEnabled = true;
  private gainScale = 1;

  setClips(clips: readonly PlayerClip[]): void {
    this.stop();
    this.clips = new Map(clips.map((clip) => [clip.key, clip]));
  }

  /** Updates the loudness-match gains of the loaded clips (and of the one that is playing). */
  setGains(gains: Readonly<Record<string, number>>): void {
    for (const [key, gain] of Object.entries(gains)) {
      const clip = this.clips.get(key);
      if (clip) this.clips.set(key, { ...clip, gain });
    }
    if (this.playing && this.context) {
      const gain = this.clips.get(this.playing.key)?.gain ?? 1;
      this.playing.level.gain.setTargetAtTime(gain * this.gainScale, this.context.currentTime, 0.01);
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.01);
  }

  get loop(): boolean {
    return this.loopEnabled;
  }

  setLoop(loop: boolean): void {
    this.loopEnabled = loop;
    if (this.playing) this.playing.source.loop = loop;
  }

  get playingKey(): string | null {
    return this.playing ? this.playing.key : null;
  }

  get duration(): number {
    const first = this.clips.values().next().value;
    return first ? first.buffer.duration : 0;
  }

  /** Seconds into the clips, or 0 when nothing plays. */
  get position(): number {
    if (!this.playing || !this.context) return 0;
    const elapsed = Math.max(0, this.context.currentTime - this.startedAt);
    const duration = this.duration;
    if (duration <= 0) return 0;
    return this.loopEnabled ? elapsed % duration : Math.min(elapsed, duration);
  }

  get audioContext(): AudioContext | null {
    return this.context;
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (!this.context) {
      const Constructor =
        window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return null;
      this.context = new Constructor();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state !== "running") {
      try {
        await this.context.resume();
      } catch {
        return null;
      }
    }
    return this.context;
  }

  /** Starts a clip, or switches to it at the current position when another one is playing. */
  async play(key: string, fromStart = false): Promise<boolean> {
    const clip = this.clips.get(key);
    if (!clip) return false;
    const context = await this.ensureContext();
    if (!context || !this.master) return false;

    const now = context.currentTime;
    const duration = clip.buffer.duration;
    let offset = this.playing && !fromStart ? this.position : 0;
    if (offset >= duration - 0.02) offset = 0;

    const source = context.createBufferSource();
    source.buffer = clip.buffer;
    source.loop = this.loopEnabled;
    const fade = context.createGain();
    const level = context.createGain();
    level.gain.value = clip.gain * this.gainScale;
    fade.gain.setValueAtTime(0, now);
    fade.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
    source.connect(fade).connect(level).connect(this.master);

    const previous = this.playing;
    if (previous) this.fadeOut(previous, now);

    const entry: Playing = { key, source, fade, level };
    this.playing = entry;
    this.startedAt = now - offset;
    source.onended = () => {
      source.disconnect();
      if (this.playing === entry) {
        this.playing = null;
        this.onChange?.();
      }
    };
    source.start(now, offset);
    this.onChange?.();
    return true;
  }

  stop(): void {
    if (!this.playing || !this.context) {
      this.playing = null;
      return;
    }
    this.fadeOut(this.playing, this.context.currentTime);
    this.playing = null;
    this.onChange?.();
  }

  private fadeOut(entry: Playing, now: number): void {
    try {
      entry.fade.gain.cancelScheduledValues(now);
      entry.fade.gain.setValueAtTime(entry.fade.gain.value, now);
      entry.fade.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      entry.source.stop(now + FADE_SECONDS + 0.01);
    } catch {
      // The source may already have ended.
    }
  }
}
