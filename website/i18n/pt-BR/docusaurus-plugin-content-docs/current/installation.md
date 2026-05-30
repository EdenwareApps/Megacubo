[🏠](/docs/introduction) > Instalação

# Instalar o Megacubo IPTV Player

Este guia explica como **instalar o aplicativo de streaming IPTV** em várias plataformas, incluindo **Windows IPTV player**, **Android IPTV app** e **Linux IPTV software**.

## Instalar o player IPTV no Windows

1. Acesse [megacubo.tv](https://megacubo.tv)
2. Baixe o instalador mais recente para o seu sistema:
   - **Windows x64 IPTV Player**: `Megacubo_X.X.X_win_x64.exe`
   - **Windows x86 IPTV App**: `Megacubo_X.X.X_win_x86.exe`
   - **Windows ARM64 IPTV Software**: `Megacubo_X.X.X_win_arm64.exe`
3. Execute o instalador IPTV e siga as instruções de instalação
4. Abra o **Megacubo IPTV player** após a instalação ser concluída

### Modo portátil (Windows/Linux)

Para executar o Megacubo em modo portátil:
1. **Durante a instalação (Windows)**: selecione a opção "Portable Mode" no instalador
2. **Ativação manual**: crie a pasta `www/nodejs/.portable/` no diretório de instalação e reinicie o app

O modo portátil permite executar o app a partir de drives USB ou armazenamento externo sem instalação.

## Instalar o player IPTV no macOS

1. Acesse [megacubo.tv](https://megacubo.tv)
2. Baixe o arquivo `.dmg` do **macOS IPTV player** (`Megacubo_X.X.X_macos.dmg`)
3. Arraste o aplicativo IPTV para a pasta Aplicativos
4. Abra o **Megacubo IPTV player** no Finder ou Launchpad

### Notas de segurança do macOS

O Megacubo não é assinado para Mac, portanto, para executá-lo, siga estes passos:

1. **Clique com o botão direito** no app Megacubo em Aplicativos
2. Selecione **Abrir** no menu de contexto
3. Clique em **Abrir** na janela de segurança que aparecer

> **Nota**: Para algumas versões, as versões para Mac podem não estar disponíveis. Verifique a página de download para a versão mais recente.

## Instalar o player IPTV no Linux

### Instalação rápida de IPTV (recomendado)

Execute este comando no terminal para instalar o player IPTV no Linux:

```bash
wget -qO- https://megacubo.tv/install.sh | bash
```

### Instalação manual de IPTV

1. Baixe o arquivo `.tar.gz` apropriado para o Linux:
   - **Linux x64 IPTV**: `Megacubo_X.X.X_linux_x64.tar.gz`
   - **Linux ARM64 IPTV**: `Megacubo_X.X.X_linux_arm64.tar.gz`
2. Extraia o arquivo:
   ```bash
tar -xzf Megacubo_X.X.X_linux_x64.tar.gz
```
3. Execute a instalação:
   ```bash
chmod +x install.sh
sudo ./install.sh
```
4. Execute o executável:
   ```bash
./megacubo
```

### Desinstalando no Linux

Para desinstalar o Megacubo:

```bash
wget -qO- https://megacubo.tv/uninstall.sh | bash
```

### Suporte AppImage

Algumas versões incluem arquivos `.AppImage` para instalação mais fácil em distribuições Linux.

## Instalar o player IPTV no Android / TV Box

1. Ative **Fontes desconhecidas** nas configurações do dispositivo
2. Use o app Downloader para acessar: https://megacubo.tv/
3. Baixe o arquivo `.apk` do **Android IPTV player** (`Megacubo_X.X.X_android.apk`)
4. Instale o arquivo APK do IPTV
5. Abra o **Megacubo IPTV app** e comece a configuração

### Notas de instalação do Android

Se ocorrer um erro ao instalar uma nova versão:
1. **Desinstale a versão antiga** primeiro
2. **Instale a nova versão** novamente

### Permissões do Android

O app solicitará as seguintes permissões:
- **Armazenamento**: para cache e gerenciamento de arquivos
- **Internet**: para streaming de conteúdo
- **Wake Lock**: para evitar suspensão durante a reprodução
- **Estado da rede**: para monitorar a conexão em recursos de casting (Premium)

## Solução de problemas de instalação

### O antivírus bloqueia a instalação
Isso geralmente é um falso positivo. Adicione o arquivo às exceções do antivírus.

### O instalador falha
Tente executar como administrador ou desative temporariamente quaisquer ferramentas de segurança em segundo plano.

### O app não abre
Reinstale ou tente a versão portátil se disponível.

## Configuração pós-instalação

Após a instalação bem-sucedida:

1. **Abra o app** pela primeira vez
2. **Siga o assistente de configuração** para configurar as preferências
3. **Adicione sua primeira lista IPTV** ou habilite o Modo Comunidade
4. **Teste um canal** para garantir que tudo funcione

## Atualizando o Megacubo

### Atualizações manuais
- Baixe a versão mais recente de [megacubo.tv](https://megacubo.tv)
- Instale sobre a versão existente
- Suas configurações e listas serão preservadas

### Verificando atualizações
- O app pode notificar quando novas versões estiverem disponíveis
- Você também pode verificar manualmente no site oficial

## Backup e restauração

### Exportando configurações
1. Vá para **Opções** > **Exportar | Importar**
2. Clique em **Exportar Configurações**
3. Salve o arquivo de configuração

### Importando configurações
1. Vá para **Opções** > **Exportar | Importar**
2. Clique em **Importar Configurações**
3. Selecione seu arquivo salvo

---

*Se você encontrar algum problema durante a instalação, consulte nosso guia de [Solução de Problemas](troubleshooting.md), visite nosso [site](https://megacubo.tv/en/english/) ou entre em contato com nossa equipe de suporte em contact@megacubo.tv.*

**Para desenvolvedores:** veja [configuração de desenvolvimento](developing.md) para construir a partir do código-fonte.

**Próximo:** [Solução de Problemas](troubleshooting.md)
**Anterior:** [FAQ](faq.md)
