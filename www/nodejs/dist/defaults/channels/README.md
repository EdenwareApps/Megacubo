# World TV Channels
JSON list of TV stations names and categories from around the world.

# Syntax
```
Channel name (without commas), optional keywords
```

Optional keywords are used to find the channel in a IPTV M3U list. Supports negate (-keyword) and "OR" scheme (group #1 of keywords | group #2 of keywords).

Examples:

```
CoolTV News
```
If channel name is always like this in IPTV lists, omit keywords and comma.

```
CoolTV, cooltv -news -sports
```
Exclude news and sports variations of channel.

```
CoolTV, cool
```
If we just need to lookup for one word to find channel

```
CoolTV, cooltv | cool tv
```
If channel name can be written differently on iptv lists.

Category names always in English, Megacubo will translate it.

Example usages can be found [here](https://github.com/efoxbr/world-tv-channels/blob/main/br.json).


# Contribute
Feel free to send PRs, questions and suggestions. This list is primarily built for the [Megacubo](https://github.com/efoxbr/megacubo) project.
