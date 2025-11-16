package tv.megacubo.app;

import com.getcapacitor.BridgeActivity;
import android.util.Log;
import android.content.res.Configuration;
import android.os.Handler;
import tv.megacubo.pip.PIPPlugin;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private Runnable onUserLeaveHintCallback;
    private boolean isInPipMode = false;

    public void setOnUserLeaveHintCallback(Runnable callback) {
        this.onUserLeaveHintCallback = callback;
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Only call callback if not already in PiP to prevent multiple entries
        boolean isInPipMode = isInPictureInPictureMode();
        if (onUserLeaveHintCallback != null && !isInPipMode) {
            Log.d(TAG, "onUserLeaveHint: Calling callback");
            onUserLeaveHintCallback.run();
        } else if (isInPipMode) {
            Log.d(TAG, "onUserLeaveHint: Already in PiP, skipping callback");
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Don't trigger PiP on pause if already in PiP or changing configurations
        if (onUserLeaveHintCallback != null && !isInPictureInPictureMode() && !isChangingConfigurations()) {
            Log.d(TAG, "onPause: Calling callback (not in PiP, not changing config)");
            onUserLeaveHintCallback.run();
        }
    }
    
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Only trigger PiP on window focus loss if not already in PiP
        // Add delay to avoid trigger during initialization (when player is starting)
        if (!hasFocus && onUserLeaveHintCallback != null && !isInPictureInPictureMode()) {
            // Use Handler to add delay - only trigger PiP if focus is still lost after delay
            // This prevents false triggers during player initialization
            new Handler().postDelayed(new Runnable() {
                @Override
                public void run() {
                    // Verify focus is still lost and not in PiP (may have changed during delay)
                    if (!hasWindowFocus() && !isInPictureInPictureMode() && onUserLeaveHintCallback != null) {
                        Log.d(TAG, "onWindowFocusChanged: Window lost focus (confirmed), calling callback");
                        onUserLeaveHintCallback.run();
                    }
                }
            }, 500); // 500ms delay to confirm focus is really lost (not just during initialization)
        }
    }
    
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        this.isInPipMode = isInPictureInPictureMode;
        Log.d(TAG, "onPictureInPictureModeChanged: isInPip=" + isInPictureInPictureMode);
        
        if (!isInPictureInPictureMode) {
            // PiP was exited - activity should be fully visible now
            Log.d(TAG, "PiP mode exited, activity is now fullscreen");
        }
    }
}