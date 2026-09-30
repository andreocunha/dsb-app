package br.com.desafiosolar.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // O site ocupa a tela inteira, por baixo das barras do sistema, em todas as versões.
        // No Android 15+ isso já é obrigatório; aqui vale também do 8 ao 14, e o site
        // cuida dos recuos com env(safe-area-inset-*).
        // Depois do super: antes dele o tema da tela de abertura ainda não foi trocado e o
        // Android desenha uma barra de título preta com o nome do app.
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }
}
