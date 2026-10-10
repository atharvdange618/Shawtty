import { Config } from '@remotion/cli/config';

// Required for HyperFrames eval parity (skill remotion-to-hyperframes, Step 4):
// match pixel format so the SSIM diff measures translation fidelity,
// not encoder differences (~0.05 SSIM hit otherwise).
Config.setVideoImageFormat('png');
Config.setColorSpace('bt709');
