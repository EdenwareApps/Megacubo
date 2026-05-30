[🏠](/docs/introduction) > IPTV Troubleshooting

# Guia de Solução de Problemas do Player IPTV

## Erros comuns e correções

| Erro | Solução |
|-------|----------|
| Não é possível carregar a lista | Verifique a URL ou a conexão com a internet |
| A reprodução continua a fazer buffering | Habilite o Modo para Dispositivos Lentos ou mude de transmissão |
| O app não inicia | Reinstale ou verifique a interferência do antivírus |
| Sem áudio | Verifique o dispositivo de saída ou altere a faixa de áudio |
| Tela preta | Desative a aceleração de hardware nas configurações avançadas |
| Alto uso de memória | Habilite o modo “Para dispositivos lentos” nas configurações de desempenho |

## Testando transmissões diferentes

Se um canal não funcionar:

1. Clique no ícone de setas circulares.
2. O app testará automaticamente transmissões alternativas.

## Gerando relatórios de diagnóstico

### Logs de debug
1. **Windows**: execute `megacubo-debug.cmd` na pasta de instalação
2. **Linux**: execute `megacubo-debug.sh` na pasta de instalação
3. **Android**: use as opções de desenvolvedor no app

### Opções do desenvolvedor
1. Vá em **Opções** > **Avançado** > **Opções do desenvolvedor**
2. Habilite recursos de debug para solução de problemas
3. Acesse configurações avançadas e logs

## Lidando com falsos positivos de antivírus

Alguns antivírus podem sinalizar o Megacubo incorretamente:

1. Adicione a pasta do app às exceções do antivírus.
2. Permita o domínio `megacubo.tv`.
3. Reinicie o app.

### Informações de segurança
- **Sem execução de malware**: nenhuma vulnerabilidade de segurança causada pelo conteúdo das listas
- **Validação de URL**: validação automática de URLs de transmissão
- **Processamento local**: a maioria dos dados é processada localmente no dispositivo

## Problemas de áudio e vídeo

### Sem áudio
1. Verifique o volume do sistema
2. Verifique o dispositivo de saída de áudio
3. Tente alterar a faixa de áudio (menu de três pontos > Mais opções > Selecionar áudio)
4. Reinicie o app

### Problemas de vídeo
1. **Tela preta**: desative a aceleração de hardware
2. **Qualidade ruim**: verifique a velocidade da internet (mínimo 200KBps)
3. **Lag**: habilite o modo de desempenho
4. **Sem vídeo**: tente outro canal

### Seleção de qualidade
- **Opções disponíveis**: menu de três pontos > Mais opções > Selecionar qualidade
- **Qualidade única**: se a opção faltar, a transmissão possui apenas um nível de qualidade
- **Ajuste automático**: o app seleciona a melhor qualidade para sua conexão

## Problemas de desempenho do app

### Uso de memória
- **Alto uso de memória**: habilite modo para dispositivos lentos
- **Gerencie o cache**: limpe o cache em Opções > Avançado > Opções do desenvolvedor
- **Reduza o número de listas** carregadas simultaneamente

### Carregamento lento
- **Limpe o cache** em Opções > Avançado > Opções do desenvolvedor
- **Reinicie o app**
- **Verifique a memória disponível**
- **Desative recursos desnecessários**

### Travamentos
1. **Atualize para a versão mais recente**
2. **Limpe os dados do app**
3. **Reinstale o app**
4. **Verifique os requisitos do sistema**

## Solução de problemas avançada

### Modo de debug
1. **Habilite opções de desenvolvedor**: Opções > Avançado > Opções do desenvolvedor
2. **Acesse logs de debug**: execute o script megacubo-debug
3. **Monitore o desempenho**: verifique memória e CPU

### Monitoramento de desempenho
- **Uso de memória**: monitore pelo gerenciador de tarefas do sistema
- **Uso de CPU**: normal durante reprodução, mínimo em repouso
- **Uso de rede**: 200KBps a 2MBps por transmissão ativa

### Gerenciamento de cache
- **Cache em disco**: habilite em Opções > Avançado > Opções do desenvolvedor
- **Limite de cache**: padrão 1GB, ajustável
- **Limpeza automática**: arquivos antigos são removidos automaticamente

## Obtendo ajuda adicional

Se as soluções acima não funcionarem:

1. **Gere um relatório de diagnóstico** usando ferramentas de debug
2. **Verifique o FAQ**
3. **Visite nosso site**: [megacubo.tv](https://megacubo.tv/en/english/)
4. **Envie um e-mail de suporte** para contact@megacubo.tv
5. **Contate nossa equipe de suporte** em contact@megacubo.tv

## Dicas de prevenção

- **Mantenha o app atualizado**
- **Use listas IPTV confiáveis**
- **Mantenha uma boa conexão com a internet** (mínimo 200KBps)
- **Limpe o cache regularmente**
- **Faça backup das configurações** usando o recurso de exportação
- **Monitore os recursos do sistema** em dispositivos antigos

## Problemas específicos por plataforma

### Windows
- **Interferência de antivírus**: adicione exceções
- **Problemas de permissão**: execute como administrador se necessário
- **Modo portátil**: crie a pasta `www/nodejs/.portable/`

### Android
- **Problemas de permissão**: conceda todas as permissões necessárias
- **Acesso ao armazenamento**: garanta que as permissões de armazenamento estejam habilitadas
- **Operação em segundo plano**: pode ser afetada pela otimização de bateria

### Linux
- **Problemas de permissão**: verifique as permissões de arquivos
- **Dependências**: certifique-se de instalar as bibliotecas necessárias
- **Isolamento de processos**: limitado a dois processos de trabalho

---

*A maioria dos problemas pode ser resolvida com estas etapas. Se persistirem, entre em contato com nossa equipe de suporte com o relatório de diagnóstico.*

**Próximo:** [Support & Contact](support.md)
**Anterior:** [Instalação](installation.md)
