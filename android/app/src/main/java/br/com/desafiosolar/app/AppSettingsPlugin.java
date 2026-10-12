package br.com.desafiosolar.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Abre a tela de notificações do DSB nos ajustes do Android. Quem recusou a permissão duas vezes
 * não vê mais a pergunta do sistema: só libera por lá (o site chama pelas Configurações, lib/push.ts).
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {
    @PluginMethod
    public void openNotifications(PluginCall call) {
        String pacote = getContext().getPackageName();
        Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pacote)
            // Android 7: não há tela só de notificações; abre a página do app, que leva até elas.
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pacote, null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível abrir os ajustes do aparelho.", e);
        }
    }
}
