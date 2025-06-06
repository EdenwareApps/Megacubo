# Keep all classes and members from Capacitor-NodeJS
-keep class net.hampoelz.capacitor.nodejs.** { *; }

# Keep the NodeProcess class and its native methods
-keep class net.hampoelz.capacitor.nodejs.NodeProcess {
    public native void nativeReceive(java.lang.String, java.lang.String);
    public native void nativeStart(java.lang.String[], java.lang.String[][], boolean);
}

# Keep all classes and members from any native class used by the plugin
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep native libraries (.so) in the APK
-keep class com.google.android.trichromelibrary.** { *; }

# Keep FFmpegKit and SmartException (useful if using ffmpeg)
-keep class com.arthenica.ffmpegkit.** { *; }
-keep class com.arthenica.smartexception.** { *; }
-keep class com.arthenica.smartexception.java.** { *; }

# Prevent unnecessary warnings from these libraries
-dontwarn com.arthenica.ffmpegkit.**
-dontwarn com.arthenica.smartexception.**

# Optional: preserve source code lines for debugging
-keepattributes SourceFile,LineNumberTable

# Optional: hide the original source file name (for maximum obfuscation)
-renamesourcefileattribute SourceFile