# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

-keepclasseswithmembers class * {
    native <methods>;
}

# Keep all classes and members from ffmpeg-kit
-keep class com.arthenica.ffmpegkit.** { *; }

# Keep all classes and members from smartexception
-keep class com.arthenica.smartexception.** { *; }

# Keep all classes and members from smartexception
-keep class com.arthenica.smartexception.java.** { *; }

# Avoid warnings related to ffmpeg-kit and smartexception
-dontwarn com.arthenica.ffmpegkit.**
-dontwarn com.arthenica.smartexception.**