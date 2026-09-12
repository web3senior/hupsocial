/**
 * @file lib/emoji.js
 * @description The composer's emoji vocabulary, plus the recently-used list behind it.
 *
 * Hand-held rather than pulled from a package: every emoji picker on npm ships its own renderer,
 * its own sprite sheets and a megabyte of CLDR annotations, and the composer needs none of that —
 * the glyphs are already in the system font. What is left is a list, and a list is data.
 *
 * Each group is one string so the data stays readable in a diff: entries split on the pipe, and
 * inside an entry the first token is the glyph and the rest are the search keywords. The keywords
 * are the whole reason for the file — an emoji nobody can find by typing is an emoji nobody uses.
 *
 * No country flags. A flag is composed from two regional-indicator letters and Windows ships no
 * glyphs for the pairs, so a Flags tab would be a grid of letter boxes on the platform most of
 * this app is written on — the same reason lib/origin.js gives a country no emoji. The handful of
 * flags that are single glyphs everywhere (chequered, pirate, rainbow) live under Symbols.
 */

// Entry format: "<glyph> <keyword> <keyword> ...", entries separated by a pipe.
const GROUP_DATA = [
  [
    'smileys',
    'Smileys',
    '\u{1F600}',
    `😀 grinning face smile happy | 😃 smiley happy joy | 😄 smile happy laugh | 😁 beaming grin |
     😆 laughing satisfied haha | 😅 sweat smile nervous relief | 🤣 rofl rolling laughing |
     😂 joy tears laughing lol | 🙂 slight smile | 🙃 upside down silly sarcasm | 🫠 melting hot |
     😉 wink flirt | 😊 blush smile happy | 😇 innocent halo angel | 🥰 smiling hearts love adore |
     😍 heart eyes love crush | 🤩 star struck wow amazed | 😘 blowing kiss love | 😗 kissing |
     ☺️ relaxed smiling | 😚 kissing closed eyes | 😙 kissing smiling eyes | 🥲 smiling tear grateful |
     😋 yum savoring delicious tasty | 😛 tongue out | 😜 winking tongue silly | 🤪 zany goofy crazy |
     😝 squinting tongue | 🤑 money mouth rich dollar | 🤗 hugging hug | 🤭 hand over mouth giggle oops |
     🫢 hand mouth open eyes shock | 🤫 shushing quiet secret | 🤔 thinking hmm consider |
     🫡 salute respect yes sir | 🤐 zipper mouth secret | 🤨 raised eyebrow suspicious doubt |
     😐 neutral meh | 😑 expressionless blank | 😶 no mouth speechless | 🫥 dotted line invisible hide |
     😏 smirk smug | 😒 unamused annoyed | 🙄 rolling eyes whatever | 😬 grimacing awkward |
     🤥 lying nose pinocchio | 😌 relieved calm | 😔 pensive sad | 😪 sleepy tired | 🤤 drooling |
     😴 sleeping zzz | 😷 mask sick | 🤒 thermometer fever sick | 🤕 head bandage hurt |
     🤢 nauseated gross sick | 🤮 vomiting sick | 🤧 sneezing | 🥵 hot heat sweating |
     🥶 cold freezing | 🥴 woozy drunk dizzy | 😵 dizzy knocked out | 🤯 exploding head mind blown |
     🤠 cowboy | 🥳 partying celebration birthday | 🥸 disguised glasses | 😎 sunglasses cool |
     🤓 nerd geek glasses | 🧐 monocle inspect | 😕 confused | 🫤 diagonal mouth unsure |
     😟 worried | 🙁 slight frown | ☹️ frowning | 😮 open mouth wow | 😯 hushed surprise |
     😲 astonished shocked | 😳 flushed embarrassed | 🥺 pleading puppy eyes beg |
     🥹 holding back tears | 😦 frowning open mouth | 😧 anguished | 😨 fearful scared |
     😰 anxious sweat | 😥 sad relieved | 😢 crying tear sad | 😭 loudly crying sob |
     😱 screaming fear scream | 😖 confounded | 😣 persevering | 😞 disappointed |
     😓 downcast sweat | 😩 weary tired | 😫 exhausted tired | 🥱 yawning bored |
     😤 triumph huff steam | 😡 pouting angry rage mad | 😠 angry mad | 🤬 cursing swearing |
     😈 smiling imp devil | 👿 imp angry devil | 💀 skull dead | ☠️ skull crossbones | 💩 poop |
     🤡 clown | 👹 ogre | 👺 goblin | 👻 ghost boo | 👽 alien | 👾 space invader game |
     🤖 robot bot | 😺 grinning cat | 😹 cat joy tears | 😻 heart eyes cat | 😼 wry cat smirk |
     🙀 weary cat shock | 😿 crying cat | 😾 pouting cat | 🙈 see no evil monkey |
     🙉 hear no evil monkey | 🙊 speak no evil monkey | 💋 kiss mark lips | 💌 love letter |
     💘 heart arrow cupid | 💝 heart ribbon gift | 💖 sparkling heart | 💗 growing heart |
     💓 beating heart | 💞 revolving hearts | 💕 two hearts | ❤️ red heart love | 🧡 orange heart |
     💛 yellow heart | 💚 green heart | 💙 blue heart | 💜 purple heart | 🖤 black heart |
     🤍 white heart | 🤎 brown heart | ❤️‍🔥 heart on fire | 💔 broken heart |
     ❣️ heart exclamation | 💯 hundred perfect score | 💢 anger symbol | 💥 collision boom explosion |
     💫 dizzy stars | 💦 sweat droplets water | 💨 dash wind fast | 💬 speech balloon comment |
     💭 thought balloon | 💤 zzz sleep`,
  ],
  [
    'people',
    'People',
    '\u{1F44B}',
    `👋 wave hello hi bye gm | 🤚 raised back hand | 🖐️ hand fingers splayed | ✋ raised hand stop |
     🖖 vulcan salute spock | 🫱 rightwards hand | 🫲 leftwards hand | 🫳 palm down hand |
     🫴 palm up hand | 👌 ok hand perfect | 🤌 pinched fingers italian | 🤏 pinching small |
     ✌️ victory peace | 🤞 crossed fingers luck | 🫰 hand heart fingers love |
     🤟 love you gesture | 🤘 horns rock | 🤙 call me shaka | 👈 point left | 👉 point right |
     👆 point up | 👇 point down | ☝️ index up | 🫵 point at viewer you | 👍 thumbs up like yes |
     👎 thumbs down dislike no | ✊ raised fist | 👊 fist bump punch | 🤛 left fist |
     🤜 right fist | 👏 clap applause bravo | 🙌 raising hands praise | 🫶 heart hands love |
     👐 open hands | 🤲 palms up together | 🤝 handshake deal agree | 🙏 folded hands please thanks pray |
     ✍️ writing hand | 💅 nail polish | 🤳 selfie | 💪 flexed biceps strong muscle |
     🦾 mechanical arm | 🦵 leg | 🦶 foot | 👂 ear | 👃 nose | 🧠 brain | 🫀 anatomical heart organ |
     🫁 lungs | 🦷 tooth | 🦴 bone | 👀 eyes look | 👁️ eye | 👅 tongue | 👄 mouth lips |
     🫦 biting lip | 👶 baby | 🧒 child | 👦 boy | 👧 girl | 🧑 person adult | 👨 man | 👩 woman |
     🧓 older person | 👴 old man | 👵 old woman | 🙍 person frowning | 🙎 person pouting |
     🙅 person gesturing no | 🙆 person gesturing ok | 💁 tipping hand info sassy |
     🙋 raising hand question | 🧏 deaf person | 🙇 bowing sorry | 🤦 facepalm | 🤷 shrug idk |
     👮 police officer cop | 🕵️ detective spy | 💂 guard | 🥷 ninja | 👷 construction worker |
     🤴 prince | 👸 princess | 👳 person turban | 🧕 woman headscarf | 🤵 person tuxedo |
     👰 person veil bride | 🤰 pregnant | 🤱 breast feeding | 👼 baby angel | 🎅 santa claus |
     🤶 mrs claus | 🦸 superhero | 🦹 supervillain | 🧙 mage wizard | 🧚 fairy | 🧛 vampire |
     🧜 merperson mermaid | 🧝 elf | 🧞 genie | 🧟 zombie | 💆 person massage | 💇 haircut |
     🚶 person walking | 🧍 person standing | 🧎 person kneeling | 🏃 person running |
     💃 woman dancing | 🕺 man dancing | 👯 people bunny ears party | 🧖 person sauna |
     🧗 person climbing | 🤺 fencing | 🏇 horse racing | ⛷️ skier | 🏂 snowboarder |
     🏌️ golfing | 🏄 surfing | 🚣 rowing boat | 🏊 swimming | ⛹️ bouncing ball basketball |
     🏋️ weight lifting gym | 🚴 biking cyclist | 🚵 mountain biking | 🤸 cartwheel |
     🤼 wrestling | 🤽 water polo | 🤾 handball | 🤹 juggling | 🧘 lotus meditation yoga |
     🛀 bath | 🛌 in bed sleep | 👭 women holding hands | 👫 couple holding hands |
     👬 men holding hands | 💏 kiss couple | 💑 couple with heart | 👪 family |
     🗣️ speaking head | 👤 bust silhouette user | 👥 busts silhouette users | 🫂 people hugging`,
  ],
  [
    'nature',
    'Nature',
    '\u{1F436}',
    `🐶 dog face puppy | 🐱 cat face | 🐭 mouse face | 🐹 hamster | 🐰 rabbit bunny | 🦊 fox |
     🐻 bear | 🐼 panda | 🐻‍❄️ polar bear | 🐨 koala | 🐯 tiger face | 🦁 lion | 🐮 cow face |
     🐷 pig face | 🐽 pig nose | 🐸 frog | 🐵 monkey face | 🐒 monkey | 🐔 chicken | 🐧 penguin |
     🐦 bird | 🐤 baby chick | 🦆 duck | 🦅 eagle | 🦉 owl | 🦇 bat | 🐺 wolf | 🐗 boar |
     🐴 horse face | 🦄 unicorn | 🐝 bee honeybee | 🪱 worm | 🐛 bug caterpillar | 🦋 butterfly |
     🐌 snail | 🐞 ladybug beetle | 🐜 ant | 🪰 fly | 🪲 beetle | 🦗 cricket | 🕷️ spider |
     🕸️ spider web | 🦂 scorpion | 🐢 turtle | 🐍 snake | 🦎 lizard | 🦖 trex dinosaur |
     🦕 sauropod dinosaur | 🐙 octopus | 🦑 squid | 🦐 shrimp | 🦞 lobster | 🦀 crab |
     🐡 blowfish | 🐠 tropical fish | 🐟 fish | 🐬 dolphin | 🐳 spouting whale | 🐋 whale |
     🦈 shark | 🐊 crocodile | 🐅 tiger | 🐆 leopard | 🦓 zebra | 🦍 gorilla | 🦧 orangutan |
     🐘 elephant | 🦛 hippopotamus | 🦏 rhinoceros | 🐪 camel | 🦒 giraffe | 🦘 kangaroo |
     🐃 water buffalo | 🐄 cow | 🐎 horse | 🐖 pig | 🐏 ram | 🐑 sheep ewe | 🦙 llama | 🐐 goat |
     🦌 deer | 🐕 dog | 🐩 poodle | 🦮 guide dog | 🐈 cat | 🐓 rooster | 🦃 turkey | 🦤 dodo |
     🦚 peacock | 🦜 parrot | 🦢 swan | 🦩 flamingo | 🕊️ dove peace | 🐇 rabbit | 🦝 raccoon |
     🦨 skunk | 🦡 badger | 🦦 otter | 🦥 sloth | 🐁 mouse | 🐀 rat | 🐿️ squirrel chipmunk |
     🦔 hedgehog | 🐾 paw prints | 🐉 dragon | 🐲 dragon face | 🌵 cactus | 🎄 christmas tree |
     🌲 evergreen tree | 🌳 deciduous tree | 🌴 palm tree | 🪴 potted plant | 🌱 seedling |
     🌿 herb | ☘️ shamrock | 🍀 four leaf clover luck | 🍃 leaf fluttering wind |
     🍂 fallen leaf autumn | 🍁 maple leaf | 🍄 mushroom | 🐚 shell | 🪨 rock | 🌾 sheaf rice |
     💐 bouquet flowers | 🌷 tulip | 🌹 rose | 🥀 wilted flower | 🌺 hibiscus |
     🌸 cherry blossom sakura | 🌼 blossom | 🌻 sunflower | 🌞 sun face | 🌝 full moon face |
     🌚 new moon face | 🌕 full moon | 🌗 last quarter moon | 🌑 new moon | 🌒 waxing crescent |
     🌓 first quarter moon | 🌔 waxing gibbous | 🌙 crescent moon | 🌎 globe americas earth |
     🌍 globe europe africa earth | 🌏 globe asia australia earth | 🪐 ringed planet saturn |
     ⭐ star | 🌟 glowing star | ✨ sparkles magic | ⚡ high voltage lightning zap | ☄️ comet |
     🔥 fire lit hot | 🌪️ tornado | 🌈 rainbow | ☀️ sun | ⛅ sun behind cloud | ☁️ cloud |
     🌧️ rain cloud | ⛈️ cloud lightning rain | 🌨️ snow cloud | ❄️ snowflake | ☃️ snowman snow |
     ⛄ snowman | 🌬️ wind face | 💧 droplet water | ☔ umbrella rain | 🌊 water wave ocean`,
  ],
  [
    'food',
    'Food',
    '\u{1F354}',
    `🍏 green apple | 🍎 red apple | 🍐 pear | 🍊 tangerine orange | 🍋 lemon | 🍌 banana |
     🍉 watermelon | 🍇 grapes | 🍓 strawberry | 🫐 blueberries | 🍈 melon | 🍒 cherries |
     🍑 peach | 🥭 mango | 🍍 pineapple | 🥥 coconut | 🥝 kiwi | 🍅 tomato | 🍆 eggplant aubergine |
     🥑 avocado | 🥦 broccoli | 🥬 leafy green | 🥒 cucumber | 🌶️ hot pepper spicy |
     🫑 bell pepper | 🌽 corn | 🥕 carrot | 🫒 olive | 🧄 garlic | 🧅 onion | 🥔 potato |
     🍠 roasted sweet potato | 🥐 croissant | 🥯 bagel | 🍞 bread | 🥖 baguette | 🥨 pretzel |
     🧀 cheese | 🥚 egg | 🍳 cooking fried egg | 🧈 butter | 🥞 pancakes | 🧇 waffle | 🥓 bacon |
     🥩 steak cut of meat | 🍗 poultry leg chicken | 🍖 meat on bone | 🌭 hot dog |
     🍔 hamburger burger | 🍟 french fries | 🍕 pizza | 🫓 flatbread | 🥪 sandwich |
     🥙 stuffed flatbread | 🧆 falafel | 🌮 taco | 🌯 burrito | 🫔 tamale | 🥗 green salad |
     🥘 shallow pan paella | 🫕 fondue | 🥫 canned food | 🍝 spaghetti pasta |
     🍜 steaming bowl ramen noodles | 🍲 pot of food stew | 🍛 curry rice | 🍣 sushi |
     🍱 bento box | 🥟 dumpling | 🦪 oyster | 🍤 fried shrimp | 🍙 rice ball | 🍚 cooked rice |
     🍘 rice cracker | 🍥 fish cake | 🥠 fortune cookie | 🥮 moon cake | 🍢 oden | 🍡 dango |
     🍧 shaved ice | 🍨 ice cream | 🍦 soft ice cream | 🥧 pie | 🧁 cupcake | 🍰 shortcake |
     🎂 birthday cake | 🍮 custard flan | 🍭 lollipop | 🍬 candy | 🍫 chocolate bar |
     🍿 popcorn | 🍩 doughnut donut | 🍪 cookie | 🌰 chestnut | 🥜 peanuts | 🍯 honey pot |
     🥛 glass of milk | 🍼 baby bottle | 🫖 teapot | ☕ hot beverage coffee | 🍵 teacup tea |
     🧃 juice box beverage | 🥤 cup with straw soda | 🧋 bubble tea boba | 🍶 sake |
     🍺 beer mug | 🍻 clinking beer mugs cheers | 🥂 clinking glasses champagne cheers |
     🍷 wine glass | 🥃 tumbler whiskey | 🍸 cocktail martini | 🍹 tropical drink | 🧉 mate |
     🍾 bottle popping champagne celebrate | 🧊 ice cube | 🥄 spoon | 🍴 fork and knife |
     🍽️ plate cutlery dinner | 🥣 bowl with spoon | 🥡 takeout box | 🧂 salt`,
  ],
  [
    'activity',
    'Activity',
    '\u{26BD}',
    `⚽ soccer football | 🏀 basketball | 🏈 american football | ⚾ baseball | 🥎 softball |
     🎾 tennis | 🏐 volleyball | 🏉 rugby | 🥏 flying disc frisbee | 🎱 pool billiards eight ball |
     🪀 yo yo | 🏓 ping pong table tennis | 🏸 badminton | 🏒 ice hockey | 🏑 field hockey |
     🥍 lacrosse | 🏏 cricket game | 🪃 boomerang | 🥅 goal net | ⛳ flag in hole golf | 🪁 kite |
     🏹 bow and arrow archery | 🎣 fishing pole | 🤿 diving mask | 🥊 boxing glove |
     🥋 martial arts uniform | 🎽 running shirt | 🛹 skateboard | 🛼 roller skate | 🛷 sled |
     ⛸️ ice skate | 🥌 curling stone | 🎿 skis | 🏆 trophy win champion | 🥇 first place gold medal |
     🥈 second place silver medal | 🥉 third place bronze medal | 🏅 sports medal |
     🎖️ military medal | 🎗️ reminder ribbon | 🎫 ticket | 🎟️ admission tickets | 🎪 circus tent |
     🎭 performing arts theater | 🩰 ballet shoes | 🎨 artist palette art | 🎬 clapper board movie |
     🎤 microphone sing karaoke | 🎧 headphone music | 🎼 musical score | 🎹 musical keyboard piano |
     🥁 drum | 🪘 long drum | 🎷 saxophone | 🎺 trumpet | 🪗 accordion | 🎸 guitar | 🪕 banjo |
     🎻 violin | 🎲 game die dice | ♟️ chess pawn | 🎯 direct hit bullseye target | 🎳 bowling |
     🎮 video game controller | 🕹️ joystick | 🎰 slot machine | 🧩 puzzle piece | 🪄 magic wand |
     🎁 gift present | 🎉 party popper celebrate tada | 🎊 confetti ball | 🎈 balloon |
     🎏 carp streamer | 🎐 wind chime | 🎀 ribbon | 🧧 red envelope | 🪅 pinata |
     🎃 jack o lantern halloween | 🎆 fireworks | 🎇 sparkler | 🧨 firecracker`,
  ],
  [
    'travel',
    'Travel',
    '\u{2708}\u{FE0F}',
    `🚗 car automobile | 🚕 taxi | 🚙 suv sport utility vehicle | 🚌 bus | 🏎️ racing car |
     🚓 police car | 🚑 ambulance | 🚒 fire engine | 🚐 minibus van | 🛻 pickup truck |
     🚚 delivery truck | 🚛 lorry articulated | 🚜 tractor | 🦽 manual wheelchair |
     🛴 kick scooter | 🚲 bicycle bike | 🛵 motor scooter | 🏍️ motorcycle | 🛺 auto rickshaw |
     🚨 police light siren | 🚡 aerial tramway | 🚞 mountain railway | 🚝 monorail |
     🚄 high speed train | 🚅 bullet train | 🚂 locomotive steam train | 🚆 train |
     🚇 metro subway | 🚊 tram | 🚉 station | ✈️ airplane flight | 🛫 airplane departure takeoff |
     🛬 airplane arrival landing | 💺 seat | 🛰️ satellite | 🚀 rocket launch moon |
     🛸 flying saucer ufo | 🚁 helicopter | 🛶 canoe | ⛵ sailboat | 🚤 speedboat |
     🛥️ motor boat | 🛳️ passenger ship | ⛴️ ferry | 🚢 ship | ⚓ anchor | ⛽ fuel pump gas |
     🚧 construction barrier | 🚦 vertical traffic light | 🚥 horizontal traffic light |
     🗺️ world map | 🗿 moai statue | 🗽 statue of liberty | 🗼 tokyo tower | 🏰 castle |
     🏯 japanese castle | 🏟️ stadium | 🎡 ferris wheel | 🎢 roller coaster | 🎠 carousel horse |
     ⛲ fountain | 🏖️ beach umbrella | 🏝️ desert island | 🏜️ desert | 🌋 volcano | ⛰️ mountain |
     🏔️ snow capped mountain | 🗻 mount fuji | 🏕️ camping | ⛺ tent | 🛖 hut | 🏠 house home |
     🏡 house with garden | 🏘️ houses | 🏚️ derelict house | 🏗️ building construction |
     🏭 factory | 🏢 office building | 🏬 department store | 🏤 post office | 🏥 hospital |
     🏦 bank | 🏨 hotel | 🏪 convenience store | 🏫 school | 💒 wedding | 🏛️ classical building |
     ⛪ church | 🕌 mosque | 🕍 synagogue | 🛕 hindu temple | 🕋 kaaba | ⛩️ shinto shrine |
     🛤️ railway track | 🛣️ motorway highway | 🏞️ national park | 🌅 sunrise |
     🌄 sunrise over mountains | 🌠 shooting star | 🌇 sunset | 🌆 cityscape at dusk |
     🏙️ cityscape | 🌃 night with stars | 🌌 milky way | 🌉 bridge at night | 🌁 foggy`,
  ],
  [
    'objects',
    'Objects',
    '\u{1F4A1}',
    `⌚ watch | 📱 mobile phone | 💻 laptop computer | ⌨️ keyboard | 🖥️ desktop computer |
     🖨️ printer | 🖱️ computer mouse | 💽 computer disk | 💾 floppy disk save | 💿 optical disk cd |
     📀 dvd | 📷 camera | 📸 camera with flash | 📹 video camera | 🎥 movie camera |
     📽️ film projector | 🎞️ film frames | 📞 telephone receiver | ☎️ telephone | 📠 fax machine |
     📺 television tv | 📻 radio | 🎙️ studio microphone podcast | 🎚️ level slider |
     🎛️ control knobs | 🧭 compass | ⏱️ stopwatch | ⏲️ timer clock | ⏰ alarm clock |
     🕰️ mantelpiece clock | ⌛ hourglass done | ⏳ hourglass not done | 📡 satellite antenna |
     🔋 battery | 🪫 low battery | 🔌 electric plug | 💡 light bulb idea | 🔦 flashlight |
     🕯️ candle | 🪔 diya lamp | 🧯 fire extinguisher | 🛢️ oil drum | 💸 money with wings spend |
     💵 dollar banknote | 💴 yen banknote | 💶 euro banknote | 💷 pound banknote | 🪙 coin token |
     💰 money bag | 💳 credit card | 💎 gem stone diamond | ⚖️ balance scale | 🪜 ladder |
     🧰 toolbox | 🪛 screwdriver | 🔧 wrench | 🔨 hammer | 🛠️ hammer and wrench tools |
     ⛏️ pick mining | 🪚 carpentry saw | 🔩 nut and bolt | ⚙️ gear settings | 🧱 brick |
     ⛓️ chains | 🧲 magnet | 💣 bomb | 🪓 axe | 🔪 kitchen knife | 🗡️ dagger |
     ⚔️ crossed swords | 🛡️ shield | ⚰️ coffin | 🪦 headstone | 🏺 amphora |
     🔮 crystal ball | 📿 prayer beads | 🧿 nazar amulet | 💈 barber pole | ⚗️ alembic |
     🔭 telescope | 🔬 microscope | 🩹 adhesive bandage | 🩺 stethoscope | 💊 pill | 💉 syringe |
     🩸 drop of blood | 🧬 dna | 🦠 microbe virus | 🧫 petri dish | 🧪 test tube | 🌡️ thermometer |
     🧹 broom | 🧺 basket | 🧻 roll of paper | 🚽 toilet | 🚿 shower | 🛁 bathtub | 🧼 soap |
     🪥 toothbrush | 🪒 razor | 🧽 sponge | 🪣 bucket | 🧴 lotion bottle | 🛎️ bellhop bell |
     🔑 key | 🗝️ old key | 🚪 door | 🪑 chair | 🛋️ couch and lamp | 🛏️ bed | 🧸 teddy bear |
     🪆 nesting dolls | 🖼️ framed picture | 🪞 mirror | 🪟 window | 🛍️ shopping bags |
     🛒 shopping cart | 📩 envelope with arrow | 📨 incoming envelope | 📧 email | 📥 inbox tray |
     📤 outbox tray | 📦 package box shipping | 🏷️ label tag | 🪧 placard sign | 📫 mailbox |
     📮 postbox | 📜 scroll | 📃 page with curl | 📄 page facing up | 📑 bookmark tabs |
     🧾 receipt | 📊 bar chart | 📈 chart increasing up green | 📉 chart decreasing down red |
     🗒️ spiral notepad | 🗓️ spiral calendar | 📆 tear off calendar | 📅 calendar |
     🗑️ wastebasket trash delete | 🗳️ ballot box vote | 🗄️ file cabinet | 📋 clipboard |
     📁 file folder | 📂 open file folder | 🗞️ rolled up newspaper | 📰 newspaper news |
     📓 notebook | 📒 ledger | 📕 closed book | 📗 green book | 📘 blue book | 📙 orange book |
     📚 books library | 📖 open book read | 🔖 bookmark | 🧷 safety pin | 🔗 link chain url |
     📎 paperclip attach | 🖇️ linked paperclips | 📐 triangular ruler | 📏 straight ruler |
     🧮 abacus | 📌 pushpin | 📍 round pushpin location | ✂️ scissors cut | 🖊️ pen |
     🖋️ fountain pen | ✒️ black nib | 🖌️ paintbrush | 🖍️ crayon | 📝 memo note write |
     ✏️ pencil edit | 🔍 magnifying glass search find | 🔎 magnifying glass right |
     🔏 locked with pen | 🔐 locked with key | 🔒 locked private | 🔓 unlocked public`,
  ],
  [
    'symbols',
    'Symbols',
    '\u{1F523}',
    `💯 hundred perfect | ❗ exclamation | ❓ question | ‼️ double exclamation |
     ⁉️ exclamation question | ⚠️ warning caution | 🚸 children crossing | 🔱 trident |
     ⚜️ fleur de lis | 🔰 beginner | ♻️ recycling | ✅ check mark button yes done |
     ❎ cross mark button | ❌ cross mark no wrong | ⭕ hollow red circle | 🚫 prohibited no |
     💢 anger symbol | 🌐 globe with meridians web | 💠 diamond with a dot | 🌀 cyclone |
     ♿ wheelchair accessibility | 🚹 mens room | 🚺 womens room | 🚻 restroom | 📶 signal bars |
     🔣 input symbols | ℹ️ information | 🔤 input latin letters | 🆖 ng button | 🆗 ok button |
     🆙 up button lukso | 🆒 cool button | 🆕 new button | 🆓 free button | 0️⃣ zero |
     1️⃣ one | 2️⃣ two | 3️⃣ three | 4️⃣ four | 5️⃣ five | 6️⃣ six | 7️⃣ seven | 8️⃣ eight |
     9️⃣ nine | 🔟 keycap ten | 🔢 input numbers | #️⃣ hash keycap | *️⃣ asterisk keycap |
     ▶️ play button | ⏸️ pause button | ⏹️ stop button | ⏺️ record button | ⏭️ next track |
     ⏮️ last track | ⏩ fast forward | ⏪ fast reverse | ◀️ reverse button | 🔼 upwards button |
     🔽 downwards button | ➡️ right arrow | ⬅️ left arrow | ⬆️ up arrow | ⬇️ down arrow |
     ↗️ up right arrow | ↘️ down right arrow | ↙️ down left arrow | ↖️ up left arrow |
     ↕️ up down arrow | ↔️ left right arrow | ↪️ right arrow curving left reply |
     ↩️ left arrow curving right | 🔀 shuffle tracks | 🔁 repeat loop | 🔂 repeat single |
     🔄 refresh counterclockwise arrows | 🎵 musical note | 🎶 musical notes | ➕ plus add |
     ➖ minus | ➗ divide | ✖️ multiply | ♾️ infinity | 💲 heavy dollar sign |
     💱 currency exchange | ™️ trade mark | ©️ copyright | ®️ registered | 🔚 end arrow |
     🔙 back arrow | 🔛 on arrow | 🔝 top arrow | 🔜 soon arrow | 〰️ wavy dash | ➰ curly loop |
     ✔️ check mark | ☑️ check box with check | 🔘 radio button | 🔴 red circle |
     🟠 orange circle | 🟡 yellow circle | 🟢 green circle | 🔵 blue circle | 🟣 purple circle |
     🟤 brown circle | ⚫ black circle | ⚪ white circle | 🟥 red square | 🟧 orange square |
     🟨 yellow square | 🟩 green square | 🟦 blue square | 🟪 purple square | 🟫 brown square |
     ⬛ black large square | ⬜ white large square | 🔶 large orange diamond |
     🔷 large blue diamond | 🔸 small orange diamond | 🔹 small blue diamond |
     🔺 red triangle up | 🔻 red triangle down | 💮 white flower | ♠️ spade suit |
     ♥️ heart suit | ♦️ diamond suit | ♣️ club suit | 🃏 joker | 🎴 flower playing cards |
     🔇 muted speaker | 🔈 speaker low volume | 🔊 speaker high volume | 📢 loudspeaker announce |
     📣 megaphone shout | 🔔 bell notification | 🔕 bell with slash mute | ☮️ peace symbol |
     ✝️ latin cross | ☪️ star and crescent | 🕉️ om | ☸️ wheel of dharma | ✡️ star of david |
     🔯 dotted six pointed star | 🕎 menorah | ☯️ yin yang | ☦️ orthodox cross |
     🛐 place of worship | ⛎ ophiuchus | ♈ aries | ♉ taurus | ♊ gemini | ♋ cancer | ♌ leo |
     ♍ virgo | ♎ libra | ♏ scorpio | ♐ sagittarius | ♑ capricorn | ♒ aquarius | ♓ pisces |
     🏁 chequered flag finish race | 🚩 triangular flag | 🎌 crossed flags |
     🏴‍☠️ pirate flag | 🏳️‍🌈 rainbow flag pride | 🏳️ white flag | 🏴 black flag`,
  ],
]

const parseGroup = (data) =>
  data
    .split('|')
    .map((entry) => entry.trim().split(/\s+/))
    .filter(([char]) => Boolean(char))
    .map(([char, ...words]) => ({ char, keywords: words.join(' ') }))

/** @type {{key: string, label: string, icon: string, items: {char: string, keywords: string}[]}[]} */
export const EMOJI_GROUPS = GROUP_DATA.map(([key, label, icon, data]) => ({
  key,
  label,
  icon,
  items: parseGroup(data),
}))

// A handful of glyphs earn a place in two groups (💯 is a smiley and a symbol). Search walks this
// flattened list, so it dedupes — browsing by category keeps both placements.
const ALL_EMOJI = [...new Map(EMOJI_GROUPS.flatMap((group) => group.items).map((item) => [item.char, item])).values()]

/**
 * Keyword search across every group, in three tiers: the term opens the entry's own name, the term
 * opens any later keyword, the term sits inside one. So "fire" reaches the flame, then the heart
 * on fire, then the fire engine.
 */
export function searchEmoji(query, limit = 90) {
  const term = query.trim().toLowerCase()
  if (!term) return []

  const tiers = [[], [], []]
  for (const item of ALL_EMOJI) {
    const index = item.keywords.indexOf(term)
    if (index === -1) continue
    const tier = index === 0 ? 0 : item.keywords[index - 1] === ' ' ? 1 : 2
    tiers[tier].push(item)
    if (tiers[0].length >= limit) break
  }
  return [...tiers[0], ...tiers[1], ...tiers[2]].slice(0, limit)
}

// ■■■ [Recently used] ■■■

const RECENT_LIMIT = 24
const getRecentKey = () => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}emoji-recent`

export function loadRecentEmoji() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(getRecentKey()) || '[]')
    return Array.isArray(parsed) ? parsed.filter((char) => typeof char === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

/** Most recent first, no duplicates. Returns the new list so the caller can render it. */
export function rememberEmoji(char) {
  const next = [char, ...loadRecentEmoji().filter((item) => item !== char)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(getRecentKey(), JSON.stringify(next))
  } catch {
    // Private mode / full quota — the picker still works, it just forgets
  }
  return next
}
