package tv.megacubo.app;

import com.getcapacitor.BridgeActivity;
import android.util.Log;

public class MainActivity extends BridgeActivity {
    private Runnable onUserLeaveHintCallback;

    public void setOnUserLeaveHintCallback(Runnable callback) {
        Log.d("PIPPlugin", "setOnUserLeaveHintCallback");
        this.onUserLeaveHintCallback = callback;
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (onUserLeaveHintCallback != null) {
            Log.d("PIPPlugin", "onUserLeaveHint OK");
            onUserLeaveHintCallback.run();
        } else {
            Log.d("PIPPlugin", "onUserLeaveHint NULL");
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (onUserLeaveHintCallback != null) {
            if (!isChangingConfigurations()) { // avoid calling onUserLeaveHint when rotating the screen
                Log.d("PIPPlugin", "onUserLeaveHint OK");
                onUserLeaveHintCallback.run();
            }
        } else {
            Log.d("PIPPlugin", "onUserLeaveHint NULL");
        }
    }
    
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        if(!hasFocus) {
            if (onUserLeaveHintCallback != null) {
                Log.d("PIPPlugin", "onUserLeaveHint OK");
                onUserLeaveHintCallback.run();
            } else {
                Log.d("PIPPlugin", "onUserLeaveHint NULL");
            }
        }
    }
}