[🏠](/docs/introduction) > Performance & Optimization

# Desempenho e Otimização

## Modo para Dispositivos Lentos

Para computadores antigos ou TV Boxes:

1. Vá em **Opções** > **Modo de Desempenho**.
2. Habilite **Modo para Dispositivos Lentos**.
3. Isso desativa animações e reduz a qualidade de vídeo para reprodução mais suave.

### Gerenciamento de Memória

Para reduzir o uso de memória:
1. Vá em **Opções** > **Modo de Desempenho** > **Para dispositivos lentos**
2. Isso reduz o número de listas e EPGs carregados simultaneamente
3. Resulta em menor consumo de memória, mas menos canais disponíveis

## Opções de Pré-processamento do FFmpeg

Usuários avançados podem ajustar o comportamento do FFmpeg:

1. Vá em **Opções** > **Avançado** > **Reprodução**.
2. Defina **Usar pré-processamento FFmpeg** para:
   - **Não**
   - **Auto**
   - **Sempre**
   - **Apenas MPEGTS**

Isso afeta como o player trata diferentes tipos de transmissões.

## Configurações adicionais de desempenho

### Configurações de buffer
- **Buffer pequeno**: início mais rápido, mais buffering
- **Buffer grande**: início mais lento, reprodução mais suave
- **Auto**: ajusta automaticamente com base na conexão

### Aceleração de hardware
- **Ativar**: usa GPU para decodificação de vídeo (recomendado)
- **Desativar**: usa apenas CPU (mais compatível)

### Gerenciamento de memória
- **Modo de memória baixa**: reduz uso de memória carregando menos listas/EPGs
- **Tamanho do cache**: ajusta quanto conteúdo é armazenado em cache

## Configuração de cache em disco

### Habilitando cache em disco
1. Vá em **Opções** > **Avançado** > **Opções do desenvolvedor**
2. Habilite **Habilitar cache em disco**
3. Defina o limite de cache (padrão: 1GB)

### Gerenciamento de cache
- **Limpeza automática**: arquivos antigos do cache são removidos automaticamente
- **Limpeza manual**: limpe o cache em Opções > Avançado > Opções do desenvolvedor
- **Local do cache**: armazenado localmente no seu dispositivo

## Otimização do uso de memória

### Uso típico de memória
- **Modo normal**: varia conforme o número de listas carregadas
- **Modo lento**: consumo de memória reduzido
- **Uso de cache**: memória adicional para cache em disco

### Reduzindo o uso de memória
1. **Habilite o modo para dispositivos lentos**
2. **Reduza o número de listas carregadas**
3. **Limpe o cache regularmente**
4. **Feche outros aplicativos**

## Uso de CPU durante a reprodução

### Operação normal
- **Uso típico**: consumo de CPU normal durante a reprodução
- **Aceleração de hardware**: reduz o uso de CPU quando ativada
- **Processos em segundo plano**: uso mínimo quando não está transmitindo

### Dicas de otimização
- **Habilite aceleração de hardware** sempre que possível
- **Feche aplicativos desnecessários**
- **Use modo lento em dispositivos antigos**

## Otimizações específicas por plataforma

### Windows
- **Aceleração DirectX**: ativada automaticamente
- **Gerenciamento de memória**: Windows gerencia a alocação de memória
- **Processos em segundo plano**: impacto mínimo no desempenho

### Android
- **Aceleração de hardware**: usa GPU do dispositivo
- **Gerenciamento de memória**: sistema Android gerencia a alocação
- **Otimização de bateria**: pode afetar a operação em segundo plano

### Linux
- **Aceleração OpenGL**: usa drivers gráficos do sistema
- **Gerenciamento de memória**: kernel Linux gerencia a alocação
- **Isolamento de processos**: limitado a dois processos de trabalho para EPG e MPEG-TS

## Solução de problemas de desempenho

Se você tiver lag ou buffering:

1. Habilite **Modo para Dispositivos Lentos**
2. Reduza o tamanho do buffer em configurações avançadas
3. Desative aceleração de hardware se estiver causando problemas
4. Verifique a velocidade da internet (mínimo 200KBps)
5. Tente mudar para outra transmissão
6. Limpe o cache e reinicie o app

### Monitoramento de desempenho

### Informações de debug
- **Windows/Linux**: execute `megacubo-debug.(sh|cmd)` para logs detalhados
- **Opções do desenvolvedor**: habilite em Opções > Avançado > Opções do desenvolvedor
- **Uso de memória**: monitore no gerenciador de tarefas do sistema

### Problemas comuns de desempenho
- **Alto uso de memória**: habilite modo lento ou reduza listas carregadas
- **Buffering**: verifique a velocidade de rede e tente outras transmissões
- **Inicialização lenta**: limpe o cache e reinicie o app
- **Lag durante a reprodução**: habilite modo de desempenho ou reduza qualidade

---

*Essas configurações podem impactar significativamente o desempenho. Comece com as configurações padrão e ajuste com base nas capacidades do seu dispositivo e na condição da rede.*

**Próximo:** [Recommendations System](recommendations.md)
**Anterior:** [Modo Comunidade](community-mode.md)
