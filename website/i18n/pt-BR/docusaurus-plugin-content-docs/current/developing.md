[🏠](/docs/introduction) > IPTV Development

# Configuração de Desenvolvimento do Player IPTV

## Pré-requisitos

Antes de começar a desenvolver, verifique se você tem:
- **Node.js 22.12.0 ou superior** (recomendamos usar [nvm](https://github.com/nvm-sh/nvm))
- **Git** para clonar e gerenciar dependências
- **Pelo menos 2GB de espaço livre em disco**
- **Conexão estável com a internet**

### Verificação rápida de configuração
```bash

  # Verifica todos os pré-requisitos
```

### Desenvolvimento IPTV com Electron (Windows/Linux/macOS)

A forma mais fácil e recomendada para desenvolvimento do aplicativo desktop IPTV.

#### Instalação padrão
```
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
npm install
npm run prepare  # Compila e empacota o aplicativo
npm start        # Inicia o app (detecta automaticamente modo de desenvolvimento ou produção com base no último build)
```

#### Instalação limpa (recomendado para solução de problemas)
```
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
npm run fresh-install  # Instalação limpa com verificações de pré-requisitos
npm run prepare        # Compila e empacota o aplicativo
npm start              # Inicia o app (detecta automaticamente modo de desenvolvimento ou produção com base no último build)
```

Veja [guia de contribuição](contributing.md#iptv-development-requirements) para requisitos do sistema.

#### Comandos de build:
```bash
# Preparar o projeto (compilar e empacotar)
npm run prepare

# Build de instaladores otimizados
npm run build:electron:linux    # Linux (AppImage, Snap, Flatpak)
npm run build:electron:win      # Windows (NSIS, MSI)
npm run build:electron:mac      # macOS (DMG)
npm run build:electron:all      # Todas as plataformas
```

### Com Capacitor (Android):
```
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
npm i
npx cap sync
npx cap open android
```

### Com NPM (instalar globalmente):
```
npm i -g megacubo
npx megacubo
```

## Veja também

- **[Construção](building.md)** - Como construir instaladores Megacubo
- **[Contribuindo](contributing.md)** - Como contribuir para o projeto
- **[Instalação](installation.md)** - Instalar o Megacubo

---

[🏠](/docs/introduction) | [Construção](building.md) | [Contribuindo](contributing.md)

*Erros ao longo do caminho? [Conte para nós](https://github.com/EdenwareApps/Megacubo/issues).*
