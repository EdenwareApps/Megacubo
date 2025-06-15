# Keep the NodeProcess class and its native methods
-keep class net.hampoelz.capacitor.nodejs.NodeProcess { *; }
-keepclassmembers class net.hampoelz.capacitor.nodejs.NodeProcess {
    public native *;
}

# Keep the MainActivity class and its members
-keep class tv.megacubo.app.MainActivity { *; }

# Keep the Runnable interface and its implementations
-keep class java.lang.Runnable { *; }

# Keep FFmpegKit and SmartException
-keep class com.arthenica.ffmpegkit.** { *; }
-keep class com.arthenica.smartexception.** { *; }
-keep class com.arthenica.smartexception.java.** { *; }

# Prevent unnecessary warnings from these libraries
-dontwarn com.arthenica.ffmpegkit.**
-dontwarn com.arthenica.smartexception.**

# Keep Capacitor classes
-keep class com.getcapacitor.** { *; }
-keep public class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# Keep BackgroundMode plugin classes
-keep class ar.com.anura.plugins.backgroundmode.** { *; }
-keep public class ar.com.anura.plugins.backgroundmode.** { *; }
-dontwarn ar.com.anura.plugins.backgroundmode.**

# Keep plugin interfaces and annotations
-keep @com.getcapacitor.annotation.** class * { *; }
-keep @interface com.getcapacitor.annotation.**
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.PermissionCallback public <methods>;
}

# Keep JSObject and related classes
-keep class org.json.** { *; }
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.JSArray { *; }

# Keep plugin method parameters
-keepclassmembers,allowobfuscation class * {
    @com.getcapacitor.PluginMethod <methods>;
}

# Keep permission related classes
-keep class android.Manifest$permission { *; }
