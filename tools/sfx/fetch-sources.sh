#!/bin/sh
# Downloads the CC0 source packs used by build-atlas.py into <dir>. Needs curl, unzip (or python3) and ffmpeg.
set -e
d=${1:?usage: fetch-sources.sh <dir>}; mkdir -p "$d/src"; cd "$d"
get(){ curl -fsSL -o "$1.zip" "$2"; python3 -I -c "import zipfile;zipfile.ZipFile('$1.zip').extractall('$1')"; ln -sfn "$PWD/$1" "src/$3"; }
get kenney-impact "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip" kenney-impact
get rpg-audio "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip" rpg-audio
get interface-sounds "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip" interface-sounds
get scrapes "https://opengameart.org/sites/default/files/scrapes.zip" scrapes
get lightswitch "https://opengameart.org/sites/default/files/lightswitch_1.zip" lightswitch
get owlish "https://opengameart.org/sites/default/files/Owlish%20Media%20Sound%20Effects.zip" owlish
curl -fsSL -o leaves.mp3 "https://opengameart.org/sites/default/files/montageAudio-20120408%40143301.mp3"; ln -sfn "$PWD/leaves.mp3" src/leaves.mp3
echo "sources ready in $d/src"
