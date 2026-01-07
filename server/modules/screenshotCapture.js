import robot from 'robotjs';
import { bringToTop, getWindowBounds, setWindowBounds } from './windowManager.js';

/**
 * Capture a screenshot of a specific window
 */
export async function captureWindowScreenshot(windowId, screenWidth, screenHeight) {
  const originalBounds = getWindowBounds(windowId);
  if (!originalBounds) return null;

  try {
    // Focus the window first
    bringToTop(windowId);

    // If screen dimensions provided, resize window to fit
    if (screenWidth && screenHeight) {
      const screenSize = robot.getScreenSize();
      const maxWidth = screenSize.width - 100;
      const maxHeight = screenSize.height - 100;

      // Calculate aspect ratio from phone dimensions
      const phoneAspect = screenWidth / screenHeight;

      let newWidth, newHeight;

      if (phoneAspect < 1) {
        // Portrait mode
        newHeight = Math.min(maxHeight, screenHeight);
        newWidth = Math.round(newHeight * phoneAspect);
        if (newWidth > maxWidth) {
          newWidth = maxWidth;
          newHeight = Math.round(newWidth / phoneAspect);
        }
      } else {
        // Landscape mode
        newWidth = Math.min(maxWidth, screenWidth);
        newHeight = Math.round(newWidth / phoneAspect);
        if (newHeight > maxHeight) {
          newHeight = maxHeight;
          newWidth = Math.round(newHeight * phoneAspect);
        }
      }

      console.log(`Resizing window to ${newWidth}x${newHeight} (aspect: ${phoneAspect.toFixed(2)})`);

      // Center on screen
      const newX = Math.max(0, Math.floor((screenSize.width - newWidth) / 2));
      const newY = Math.max(0, Math.floor((screenSize.height - newHeight) / 2));

      setWindowBounds(windowId, { x: newX, y: newY, width: newWidth, height: newHeight });

      // Wait for resize to complete
      await new Promise(resolve => setTimeout(resolve, 400));
    } else {
      // Just wait for window to be visible
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Get current window bounds for capture
    const captureBounds = getWindowBounds(windowId);
    if (!captureBounds) return null;

    // Capture screen using robotjs
    const bitmap = robot.screen.capture(
      captureBounds.x,
      captureBounds.y,
      captureBounds.width,
      captureBounds.height
    );

    // Convert BGRA to RGBA
    const { width, height, image } = bitmap;
    const pixels = new Uint8Array(width * height * 4);

    for (let i = 0; i < width * height; i++) {
      const offset = i * 4;
      pixels[offset] = image[offset + 2];     // R
      pixels[offset + 1] = image[offset + 1]; // G
      pixels[offset + 2] = image[offset];     // B
      pixels[offset + 3] = 255;               // A
    }

    // Restore original bounds
    if (screenWidth && screenHeight) {
      setWindowBounds(windowId, originalBounds);
    }

    // Return as raw image data URL
    const base64 = `data:image/raw;width=${width};height=${height};base64,${Buffer.from(pixels).toString('base64')}`;

    return {
      screenshot: base64,
      bounds: captureBounds,
      width,
      height
    };
  } catch (err) {
    console.error('Screenshot error:', err);
    return null;
  }
}
