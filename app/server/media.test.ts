import { describe, expect, it } from 'vitest';
import { parseVolumeDetect } from './media';

describe('parseVolumeDetect', () => {
  it('parses mean and peak volumes', () => {
    const stats = parseVolumeDetect(
      '[Parsed_volumedetect_0 @ 0x123]\nmean_volume: -22.5 dB\nmax_volume: -3.1 dB\n',
    );

    expect(stats.meanDb).toBeCloseTo(-22.5, 5);
    expect(stats.maxDb).toBeCloseTo(-3.1, 5);
  });

  it('maps n/a (digital silence) to null', () => {
    const stats = parseVolumeDetect('mean_volume: n/a dB\nmax_volume: n/a dB\n');

    expect(stats.meanDb).toBeNull();
    expect(stats.maxDb).toBeNull();
  });

  it('returns nulls when volumedetect output is absent', () => {
    const stats = parseVolumeDetect('some unrelated log line\n');

    expect(stats.meanDb).toBeNull();
    expect(stats.maxDb).toBeNull();
  });
});
