[🏠](/docs/introduction) > IPTV Contribution

# Contribuindo para o Projeto do Player IPTV

Obrigado por considerar contribuir para o **Megacubo**! Sua ajuda é essencial para manter o projeto ativo e melhorá-lo para todos.

Existem muitas maneiras de contribuir, seja como desenvolvedor, tradutor, designer ou apenas como usuário apaixonado.

---

## Contribuindo com Código

Megacubo é um projeto de código aberto hospedado no GitHub em [github.com/EdenwareApps/megacubo](https://github.com/EdenwareApps/megacubo).

### Entendendo a base de código

Antes de contribuir com código, familiarize-se com a estrutura do projeto:

- **Módulos internos**: consulte a [documentação de módulos internos](https://github.com/EdenwareApps/Megacubo/blob/main/www/nodejs/modules/README.md) para entender como os componentes funcionam juntos
- **Arquitetura de módulos**: cada módulo é autocontido e possui sua própria documentação
- **Comunicação baseada em eventos**: os módulos se comunicam por meio do EventEmitter do Node.js
- **Configuração compartilhada**: configurações comuns são gerenciadas pelo módulo de configuração

### Requisitos de desenvolvimento IPTV {#iptv-development-requirements}

Para **construir o player IPTV** a partir do código-fonte localmente, você precisará de:
- Node.js (v14 ou superior)
- Git instalado e configurado
- Para builds: dependências do sistema e instruções de build (veja [building.md](building.md))

### Preparando o ambiente de desenvolvimento

1. **Clone o repositório**:
   ```bash
git clone https://github.com/EdenwareApps/Megacubo.git
cd Megacubo
```

2. **Instale as dependências**:
   ```bash
npm install
```

3. **Prepare o projeto** (compila e empacota o código):
   ```bash
npm run prepare
```

   Veja [configuração de desenvolvimento](developing.md#prerequisites) para mais detalhes.

4. **Teste suas alterações**:
   ```bash
npm start  # Inicia o app e detecta automaticamente modo de desenvolvimento ou produção com base no último build
```

### Comandos de build

#### Builds otimizados (recomendado - tamanho menor, proteção premium):
```bash
npm run build:electron:linux    # Linux: AppImage, Snap, Flatpak (~84MB)
npm run build:electron:win      # Windows: NSIS, MSI (~84MB)
npm run build:electron:mac      # macOS: DMG (~84MB)
npm run build:electron:all      # Todas as plataformas
```

#### Builds tradicionais (inclui todas as dependências):
```bash
npm run build:electron:linux              # Instaladores Linux (~1.3GB+)
npm run build:electron:win                # Instaladores Windows (~1.3GB+)
npm run build:electron:mac                # macOS (~1.3GB+)
```

### Passos para contribuir

1. **Fork no repositório** no GitHub.
2. **Clone seu fork** e configure o ambiente de desenvolvimento.
3. **Crie uma branch de recurso**:
   ```bash
git checkout -b feature/your-feature-name
```
4. **Faça suas alterações** e teste cuidadosamente.
5. **Construa e teste os instaladores** para garantir compatibilidade.
6. **Commit suas alterações** com mensagens claras.
7. **Envie para seu fork** e crie um pull request.

### Diretrizes de desenvolvimento

- **Siga o estilo de código existente** e as convenções
- **Escreva mensagens de commit claras** em inglês
- **Atualize a documentação** se necessário

## Traduzindo o Megacubo

Ajude a tornar o Megacubo disponível no seu idioma:

1. **Verifique as traduções existentes** na pasta `www/nodejs/lang`
2. **Crie ou atualize** os arquivos de tradução
3. **Teste a tradução** no aplicativo
4. **Envie um pull request** com suas alterações

### Diretrizes de tradução

- **Use linguagem clara e natural**
- **Mantenha consistência** com traduções existentes
- **Teste os elementos da interface** para garantir encaixe adequado
- **Siga convenções de plataforma** para seu idioma

## Relatando bugs

Encontrou um bug? Ajude-nos a corrigi-lo:

1. **Verifique issues existentes** para evitar duplicatas
2. **Crie um relatório de bug detalhado** com:
   - descrição clara do problema
   - passos para reproduzir
   - comportamento esperado vs real
   - informações do sistema (SO, versão, dispositivo)
   - capturas de tela, se possível

### Modelo de relatório de bug

```markdown
**Descrição do bug:**
[Descrição clara do problema]

**Passos para reproduzir:**
1. [Passo 1]
2. [Passo 2]
3. [Passo 3]

**Comportamento esperado:**
[O que deveria acontecer]

**Comportamento real:**
[O que realmente acontece]

**Informações do sistema:**
- SO: [Windows/macOS/Linux/Android]
- Versão: [versão do Megacubo]
- Dispositivo: [especificações do dispositivo]

**Informações de debug:**
[Execute o script megacubo-debug e inclua os logs]

**Informações adicionais:**
[Capturas de tela, logs, etc.]
```

## Solicitações de recurso

Tem uma ideia para um novo recurso?

1. **Pesquise issues existentes** para evitar duplicatas
2. **Abra uma nova issue**
3. **Use o rótulo** `enhancement`
4. **Descreva o recurso claramente** e por que ele seria útil

## Documentação

Ajude a melhorar a documentação:

- **Corrija erros de digitação** e gramática
- **Adicione informações faltantes**
- **Melhore a clareza** e organização
- **Traduza a documentação** para outros idiomas

## Suporte à comunidade

Ajude outros usuários:

- **Responda perguntas** no GitHub Discussions
- **Ajude na solução de problemas**
- **Compartilhe suas experiências** e dicas
- **Acolha novos contribuintes**

## Código de conduta

Estamos comprometidos em oferecer um ambiente acolhedor e inclusivo:

- **Seja respeitoso** com todos os contribuintes
- **Use linguagem inclusiva**
- **Seja paciente com iniciantes**
- **Foque no feedback construtivo**

## Obtendo ajuda

Precisa de ajuda?

- **Leia a documentação** cuidadosamente
- **Pergunte no GitHub Discussions**
- **Envie um e-mail** para contact@megacubo.tv
- **Entre em contato com os mantenedores** para orientação

---

*Cada contribuição, por menor que seja, ajuda a tornar o Megacubo melhor para todos. Obrigado pelo seu apoio!*

**Próximo:** [Aviso Legal](legal.md)
**Anterior:** [Suporte e Contato](support.md)
