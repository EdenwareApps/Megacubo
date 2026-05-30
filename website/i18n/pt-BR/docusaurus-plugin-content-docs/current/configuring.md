[🏠](/docs/introduction) > [Guia do Usuário](introduction.md) > Configurando

### Configurações e preferências do player IPTV
<br />

Você pode personalizar as configurações do aplicativo a qualquer momento navegando até a seção **Opções**. Aqui, você encontrará várias preferências projetadas para melhorar sua experiência.

Além disso, você tem a opção de exportar suas configurações atuais como um arquivo JSON. Para isso, vá em **Opções > Exportar | Importar > Exportar Configurações**. Um arquivo ZIP contendo `config.json` será salvo no seu dispositivo.

Para importar as configurações de volta para o aplicativo, navegue até **Opções > Exportar | Importar > Importar Configurações** e selecione um arquivo ZIP ou JSON.

Para saber mais sobre as [opções de configuração do aplicativo, clique aqui](https://github.com/EdenwareApps/Megacubo/blob/master/docs/configuring.md).

**Nota:** Algumas configurações podem exigir que você reinicie o aplicativo para que as alterações entrem em vigor.

**Nota²:** Você pode criar e importar/exportar temas de maneira semelhante, encontrada em **Ferramentas > Temas**.

<br />

#### Configurações Gerais

- **allow-edit-channel-list**: `true`  
  *Permite que os usuários editem a lista de canais.*

- **animate-background**: `slow-desktop`  
  *Define a velocidade da animação de fundo para desktop.*

- **auto-test**: `false`  
  *Habilita ou desabilita o teste automático.*

- **autocrop-logos**: `true`  
  *Corta automaticamente logos para caber na interface.*

- **background-color**: `#110B24`  
  *Define a cor de fundo do aplicativo.*

- **background-transparency**: `65`  
  *Define a transparência do fundo que revela a imagem ou vídeo de fundo.*

- **bookmarks-desktop-icons**: `true`  
  *Habilita ícones de area de trabalho para favoritos.*

- **broadcast-start-timeout**: `40`  
  *Tempo limite em segundos para iniciar uma transmissão.*

- **channels-list-smart-sorting**: `0`  
  *Determina o comportamento de ordenação inteligente da lista de canais.*

- **community-mode-lists-amount**: `0`  
  *Define o número de listas aceitas e carregadas de usuários da mesma região.*

- **connect-timeout**: `10`  
  *Tempo limite em segundos para estabelecer uma conexão.*

- **countries**: `[]`  
  *Lista de países de interesse para o usuário.*

- **epg**: `""`  
  *Define as URLs do Guia Eletrônico de Programação. Pode ser um array.*


#### Configurações do FFmpeg

- **ffmpeg-broadcast-pre-processing**: `auto`  
  *Define o comportamento de pré-processamento do FFmpeg.*

- **ffmpeg-crf**: `18`  
  *Define o Fator de Taxa Constante para qualidade de vídeo no FFmpeg.*


#### Configurações de Fonte

- **font-color**: `#FFFFFF`  
  *Define a cor da fonte usada na interface.*

- **font-family**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;`  
  *Define a família tipográfica usada na interface.*

- **font-size**: `3`  
  *Especifica o tamanho da fonte para a interface.*


#### Configurações de GPU

- **fx-nav-intensity**: `2`  
  *Controla a intensidade dos efeitos visuais durante a navegação.*

- **gpu**: `true`  
  *Habilita ou desabilita a aceleração por GPU.*


#### Configurações de Interface

- **hide-back-button**: `false`  
  *Determina se o botão Voltar é exibido ou não.*

- **hls-prefetching**: `true`  
  *Habilita pré-busca HLS para streaming mais suave.*

- **home-recommendations**: `2`  
  *Número de páginas de recomendação exibidas na tela inicial.*

- **in-disk-caching-size**: `1024`  
  *Define a quantidade máxima de cache em disco em MB.*

- **kids-fun-titles**: `true`  
  *Exibe títulos divertidos para crianças.*

- **lists**: `[]`  
  *Armazena URLs ou caminhos de listas definidos pelo usuário.*

- **live-window-time**: `180`  
  *Tempo em segundos para retenção da janela ao vivo.*

- **live-stream-fmt**: `auto`  
  *Define o formato de streaming ao vivo.*

- **locale**: `""`  
  *Define o idioma do aplicativo.*

- **miniplayer-auto**: `true`  
  *Habilita a exibição automática do miniplayer ao minimizar.*

- **only-known-channels-in-trending**: `true`  
  *Mostra apenas canais conhecidos nas tendências.*

- **osd-speak**: `false`  
  *Habilita ou desabilita a fala na tela.*

- **parental-control**: `remove`  
  *Define o comportamento do controle parental, removendo conteúdo adulto da exibição por padrão.*

- **parental-control-terms**: `"."`  
  *Termos usados para verificações de controle parental.*

- **public-lists**: `yes`  
  *Especifica se listas públicas são aceitas.*

- **play-while-loading**: `true`  
  *Permite que a reprodução continue enquanto outra transmissão carrega.*

- **playback-rate-control**: `true`  
  *Habilita controle automático de taxa de reprodução para acompanhar o buffer do stream.*

- **preferred-ip-version**: `0`  
  *Define a versão IP preferida para conexões de rede.*

- **resume**: `false`  
  *Habilita ou desabilita retomar a reprodução ao iniciar o aplicativo.*

- **stretch-logos**: `false`  
  *Determina se os logos são esticados para exibição.*

- **search-missing-logos**: `true`  
  *Habilita a busca automática por logos ausentes.*

- **show-logos**: `true`  
  *Exibe logos e miniaturas de canais.*

- **popular-searches-in-trending**: `true`  
  *Exibe pesquisas populares no conteúdo em tendência.*

- **startup-window**: `""`  
  *Especifica o modo de janela de inicialização a ser exibido.*

- **status-flags-type**: `false`  
  *Controla se o tipo de stream testado é exibido.*

- **subtitles**: `true`  
  *Habilita ou desabilita suporte a legendas.*

- **timeout-secs-energy-saving**: `60`  
  *Tempo limite em segundos para entrar em modo de economia de energia quando não estiver reproduzindo.*

- **transcoding**: `true`  
  *Habilita transcodificação para formatos de mídia.*

- **transcoding-resolution**: `720p`  
  *Define a resolução para transcodificação.*

- **mpegts-packet-filter-policy**: `1`  
  *Define a política de filtragem de pacotes MPEG-TS.*

- **mpegts-persistent-connections**: `true`  
  *Habilita conexões persistentes para streaming MPEG-TS.*

- **mpegts-use-worker**: `true`  
  *Habilita o uso de trabalhadores para processamento MPEG-TS.*

- **read-timeout**: `30`  
  *Tempo limite em segundos para leitura de dados HTTP e HTTPS.*

- **tune-concurrency**: `8`  
  *Define o nível de concorrência para sintonia.*

- **tune-ffmpeg-concurrency**: `3`  
  *Define o nível de concorrência do FFmpeg em operações de sintonia.*

- **tuning-blind-trust**: `"live,video"`  
  *Define tipos de stream confiáveis, pulando testes iniciais na sintonia.*

- **tuning-icon**: `"fas fa-sync-alt"`  
  *Especifica o ícone usado para operações de sintonia.*

- **uppercase-menu**: `false`  
  *Determina se o menu é exibido em letras maiúsculas.*

- **use-keepalive**: `true`  
  *Habilita keep-alive para conexões de rede.*

- **user-agent**: `"VLC/3.0.8 LibVLC/3.0.8"`  
  *Define o agente do usuário para solicitações de rede.*


#### Tamanhos de exibição

- **view-size**:
  - **landscape**: `{ "x": 4, "y": 3 }`   
