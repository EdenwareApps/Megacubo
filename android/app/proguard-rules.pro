# Keep the NodeProcess class and its native methods
-keep class net.hampoelz.capacitor.nodejs.NodeProcess { *; }
-keepclassmembers class net.hampoelz.capacitor.nodejs.NodeProcess {
    public native *;
}

# Keep FFmpegKit and SmartException (useful if using ffmpeg)
-keep class com.arthenica.ffmpegkit.** { *; }
-keep class com.arthenica.smartexception.** { *; }
-keep class com.arthenica.smartexception.java.** { *; }

# Prevent unnecessary warnings from these libraries
-dontwarn com.arthenica.ffmpegkit.**
-dontwarn com.arthenica.smartexception.**
