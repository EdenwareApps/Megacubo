[🏠](/docs/introduction) > Usando Listas IPTV

# Usando Listas IPTV - Guia de Playlists M3U

## Entendendo arquivos de playlist M3U IPTV

**Arquivos M3U** são o formato padrão para **playlists IPTV**, contendo links para **transmissões de TV ao vivo**. Esses arquivos de texto são amplamente usados para **streaming IPTV** e incluem informações de canal em um formato simples e legível. Uma playlist M3U típica se parece com isto:

```
#EXTM3U
#EXTINF:-1 tvg-id="br.sbt" tvg-name="SBT" tvg-logo="sbt.png",SBT
http://stream.example.com/sbt.m3u8
```

Você pode obter arquivos M3U de provedores, comunidades online ou criar o seu próprio.

## Adicionando uma nova lista IPTV

1. Vá em **Minhas Listas** > **Adicionar Lista**.
2. Insira a URL ou caminho local do seu arquivo M3U.
3. Clique em **OK** para importar.

O app irá analisar a lista e exibir todos os canais disponíveis.

### Compartilhando listas no Modo Comunidade

Ao adicionar uma lista, se o app não detectar usuário e senha na URL, ele perguntará se você deseja compartilhar a lista com a comunidade.

**Benefícios de compartilhar:**
- Ajuda outros usuários a descobrir novo conteúdo
- Contribui para o pool comunitário de canais disponíveis

**Considerações:**
- Pode causar restrições de acesso se sua lista não permitir conexões simultâneas
- Listas compartilhadas são anônimas e não revelam suas informações pessoais
- Você pode desativar o compartilhamento a qualquer momento

> **Nota**: Para informações detalhadas sobre integração com o Modo Comunidade, veja [Modo Comunidade](community-mode.md).

## Tipos e fontes de listas IPTV

### Fontes IPTV gratuitas
- **Listas compartilhadas pela comunidade** - playlists contribuídas por usuários
- **Diretórios públicos de IPTV** - bancos de dados online de canais gratuitos
- **Transmissões oficiais de emissoras** - feeds IPTV legais de provedores de conteúdo

### Serviços IPTV Premium
- **Assinaturas IPTV pagas** - provedores comerciais de IPTV
- **IPTV de operadoras de TV a cabo** - serviços IPTV tradicionais de operadoras
- **Feeds IPTV por satélite** - provedores de serviços via satélite

### Playlists IPTV personalizadas
- **Servidores IPTV autogerenciados** - streaming pessoal ou da rede local
- **IPTV no Raspberry Pi** - servidores de streaming DIY
- **Servidor de mídia doméstico IPTV** - plugins IPTV para Plex, Emby ou Jellyfin

## Editando ou removendo listas existentes

1. Vá em **Minhas Listas**.
2. Toque e segure ou clique com o botão direito em uma lista.
3. Escolha **Renomear**, **Recarregar** ou **Remover**.

## Gerenciando arquivos EPG

Os arquivos do Guia Eletrônico de Programação (EPG) fornecem programação de TV no formato XML.

Para associar um arquivo EPG:

1. Ao editar uma lista, clique em **Associar Guia de Programação**.
2. Escolha o arquivo `.xml` correspondente.
3. O guia de programação aparecerá na opção **Guia de Programação** de cada canal.

## Recursos de gerenciamento de listas

### Organizando listas
- **Renomeie listas** para melhor organização
- **Reordene listas** arrastando e soltando
- **Agrupe listas** por categoria ou região
- **Pesquise dentro das listas** por canais específicos

### Informações da lista
- **Contagem de canais** exibida para cada lista
- **Última atualização** mostrada para cada playlist
- **Indicadores de status** (ativo, quebrado, atualizando)
- **Métricas de qualidade** para confiabilidade da lista

## Opções avançadas de lista

### Backup e restauração
- **Exporte listas** para fazer backup da sua configuração
- **Importe listas** a partir de arquivos de backup
- **Sincronize entre dispositivos** (recurso Premium)

### Controle de qualidade
- **Teste canais** antes de adicionar aos favoritos
- **Reporte links quebrados** para ajudar a manter a qualidade
- **Filtre canais** por qualidade ou região

## Criando listas personalizadas

### Criação manual
1. Crie um arquivo de texto com extensão `.m3u`
2. Adicione entradas de canal seguindo o formato M3U
3. Salve e importe no Megacubo

### Requisitos de formato da lista
- **Cabeçalho**: deve começar com `#EXTM3U`
- **Informações do canal**: use o formato `#EXTINF`
- **URL do stream**: link direto para a transmissão de vídeo
- **Codificação**: UTF-8 recomendado

> **Nota**: Para informações detalhadas sobre Modo Comunidade, veja [Modo Comunidade](community-mode.md).

## Solução de problemas de listas

### Problemas comuns
- **Formato inválido**: verifique a sintaxe M3U
- **Links quebrados**: confirme as URLs de transmissão
- **Problemas de codificação**: use UTF-8 no editor de texto
- **Acesso negado**: verifique a acessibilidade da URL
- **Restrições de compartilhamento**: algumas listas podem não permitir compartilhamento comunitário

### Soluções
1. **Valide o formato M3U** com ferramentas online
2. **Teste as URLs** em um navegador
3. **Verifique a codificação do arquivo** no editor de texto
4. **Contate o provedor da lista** para suporte
5. **Desative o compartilhamento** se ele estiver causando problemas (veja [Modo Comunidade](community-mode.md))

### Validação de URL
O app valida automaticamente URLs de transmissão para garantir que elas estejam acessíveis e formatadas corretamente.

---

*O gerenciamento adequado de listas garante a melhor experiência de visualização. Atualize suas listas regularmente e reporte problemas para ajudar a manter a qualidade.*

**Próximo:** [Assistindo TV ao Vivo](watching-live-tv.md)
**Anterior:** [Visão Geral da Interface](ui-overview.md)
