package com.personal.babelslibrary;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * "Babel Resume" in the app list (for the side key's double press: Settings, Advanced features, Side key,
 * Double press, Open app). A screen of its own that shows nothing: it hands over to the app, asking it to open
 * the last thing you had open, and closes.
 */
public class Resume extends Activity {
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Intent i = new Intent(this, MainActivity.class)
                .putExtra(MainActivity.EXTRA_RESUME, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
        finish();
        overridePendingTransition(0, 0);
    }
}
