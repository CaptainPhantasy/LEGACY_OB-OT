// The owner’s first 20 rabbit holes, in shelf order. Each display has one starting URL.
// First five on each face use the upper tier; the next five use the lower tier.
const shelfEntries = [
  {
    "id": "priyom",
    "name": "Shortwave radio",
    "website": "Priyom",
    "question": "Who is that radio voice reading numbers to?",
    "trail": "Numbers-station recordings → broadcast schedules → coded messages → Cold War espionage.",
    "description": "A black portable radio with a large tuning dial and extended aerial: the kind of receiver used to hear these broadcasts.",
    "evidence": "Observed broadcasts & history",
    "url": "https://priyom.org/number-stations",
    "mark": "⌁"
  },
  {
    "id": "stargate",
    "name": "Target-photo envelope",
    "website": "CIA — Project STARGATE",
    "question": "The government really investigated claimed psychic abilities.",
    "trail": "Remote-viewing experiments → declassified session records → independent evaluations → why the program ended.",
    "description": "A cream envelope marked TARGET UNKNOWN, propped on a small stand. This display represents a concealed experimental target; it does not imply that remote viewing worked.",
    "evidence": "Documented investigation · unproven claims",
    "url": "https://www.cia.gov/stories/story/ask-molly-did-cia-really-study-psychic-powers/",
    "mark": "▱",
    "relatedLinks": [
      [
        "MKULTRA: the hearing",
        "Open the 1977 Senate hearing into the CIA’s secret behavior-modification program.",
        "https://www.intelligence.senate.gov/1977/08/03/hearings-joint-hearing-subcommittee-health-and-scientific-research-committee-human-resources-project/",
        "Archive"
      ],
      [
        "The Gateway assessment",
        "Read the Army’s 1983 assessment of altered consciousness: an archived proposal, not proof of its claims.",
        "https://www.govinfo.gov/app/details/GOVPUB-D101-PURL-gpo152943",
        "Archive"
      ],
      [
        "The Family Jewels",
        "Unseal CIA records of activities that raised legal and ethical questions inside the agency.",
        "https://nsarchive2.gwu.edu/NSAEBB/NSAEBB222/index.htm",
        "Archive"
      ]
    ]
  },
  {
    "id": "black-vault",
    "name": "UFO case-file box",
    "website": "The Black Vault",
    "question": "Open the files behind the UFO stories.",
    "trail": "Project Blue Book material → sighting reports → government records → competing explanations.",
    "description": "A small black steel document box with a UFO CASE FILES label and aged folder tabs. These are records of investigations and claims, not proof of aliens.",
    "evidence": "Documents, reports & commentary",
    "url": "https://www.theblackvault.com/casefiles/desks-project-blue-book/",
    "mark": "▤",
    "relatedLinks": [
      [
        "Project Blue Book",
        "Enter the National Archives guide to the Air Force’s decades of UFO investigations.",
        "https://www.archives.gov/research/military/air-force/ufos",
        "Archive"
      ],
      [
        "The flying-saucer memo",
        "Read the FBI’s account of the famous Hottel memo and the unconfirmed story it preserved.",
        "https://www.fbi.gov/news/stories/ufos-and-the-guy-hottel-memo",
        "Story"
      ],
      [
        "NASA looks at UAP",
        "See how NASA approaches unexplained sightings, evidence, and the search for better data.",
        "https://science.nasa.gov/uap/",
        "Research"
      ],
      [
        "Deeper into the UFO archive",
        "Browse government records on sightings and investigations across multiple agencies.",
        "https://www.archives.gov/research/topics/uaps/textual-and-microfilm",
        "Archive"
      ]
    ]
  },
  {
    "id": "crypto-museum",
    "name": "Brass cipher wheel",
    "website": "Crypto Museum",
    "question": "How do you hide a message in plain sight?",
    "trail": "Enigma machines → codebreaking → secret radios → concealed listening equipment.",
    "description": "Two nested alphabet rings on a wooden stand. This symbolic cipher wheel represents encoding and decoding; it is not an Enigma machine.",
    "evidence": "Historical equipment & research",
    "url": "https://www.cryptomuseum.com/crypto/enigma/",
    "mark": "◎",
    "relatedLinks": [
      [
        "Kryptos",
        "Inspect the coded copper sculpture that has kept cryptanalysts busy for decades.",
        "https://www.cia.gov/legacy/museum/artifact/kryptos/",
        "Archive"
      ],
      [
        "NSA’s secret histories",
        "Browse codebreaking histories, cipher machines, cryptologic puzzles, and declassified accounts.",
        "https://www.nsa.gov/History/Cryptologic-History/Historical-Publications/",
        "Archive"
      ]
    ]
  },
  {
    "id": "darpa",
    "name": "Pack-mule robot",
    "website": "DARPA",
    "question": "Some real research projects sound like science fiction.",
    "trail": "Robotic pack mules → autonomous vehicles → stealth technology → the origins of the internet.",
    "description": "A palm-sized, four-legged robot model with exposed joints and a small cargo pack, echoing DARPA’s legged robot research.",
    "evidence": "Official research history",
    "url": "https://www.darpa.mil/about/innovation-timeline",
    "mark": "⚙",
    "relatedLinks": [
      [
        "Brains & machines",
        "Explore a DARPA research program designed to translate between neurons and electronics.",
        "https://www.darpa.mil/research/programs/neural-engineering-system-design",
        "Research"
      ],
      [
        "Sea Hunter",
        "Meet the experimental ship designed for long ocean journeys without a crew aboard.",
        "https://www.darpa.mil/news/2018/sea-hunter-prototype",
        "Research"
      ],
      [
        "Robots underground",
        "Follow autonomous robots into tunnels, caves, and unfamiliar underground spaces.",
        "https://www.darpa.mil/research/challenges/subterranean",
        "Research"
      ]
    ]
  },
  {
    "id": "atlas-obscura",
    "name": "Explorer’s compass",
    "website": "Atlas Obscura",
    "question": "Start with rocks that ring like bells.",
    "trail": "Ringing Rocks Park → unusual natural places → obscure landmarks → nearby curiosities.",
    "description": "An open brass pocket compass in a worn travel case, a symbol of discovering real, unusual places.",
    "evidence": "Place-based reporting",
    "url": "https://www.atlasobscura.com/places/sonorous-stones-ringing-rocks-park",
    "mark": "⌖"
  },
  {
    "id": "subbrit",
    "name": "Miner’s lamp",
    "website": "Subterranea Britannica",
    "question": "What is underneath the street you are standing on?",
    "trail": "Underground bunkers → abandoned tunnels → mines → hidden communications sites.",
    "description": "A compact brass-and-glass miner’s lamp with a carrying loop, representing exploration of human-made underground spaces.",
    "evidence": "Documented underground history",
    "url": "https://www.subbrit.org.uk/",
    "mark": "♧"
  },
  {
    "id": "airfields",
    "name": "Airplane & forgotten runway",
    "website": "Abandoned & Little-Known Airfields",
    "question": "That empty field used to be an airport.",
    "trail": "Choose Indiana or another state → old airfield photographs → maps → personal memories → present-day remains.",
    "description": "A weathered propeller-plane model on a cracked runway base, with tiny weeds suggesting a place aviation left behind.",
    "evidence": "Photographs, maps & recollections",
    "url": "https://www.airfieldsfreeman.com/",
    "mark": "✈"
  },
  {
    "id": "rumsey",
    "name": "Antique map scroll",
    "website": "David Rumsey Map Collection",
    "question": "Explore the world as people once drew it.",
    "trail": "Imaginary maps → celestial charts → old city plans → forgotten railroad routes.",
    "description": "A partly unrolled illustrated map, tied with ribbon. This display scroll represents past and imagined worlds.",
    "evidence": "Historical map archive",
    "url": "https://www.davidrumsey.com/",
    "mark": "⌁"
  },
  {
    "id": "phaistos",
    "name": "Phaistos Disc replica",
    "website": "Omniglot — Phaistos Disc",
    "question": "A message survived, but we cannot confidently read it.",
    "trail": "Phaistos Disc → Linear A → Indus symbols → undeciphered writing systems.",
    "description": "A terracotta-colored replica with spiraling symbols, upright on a display stand. Its markings evoke the surviving disc and its unresolved interpretation.",
    "evidence": "Writing systems · unresolved reading",
    "url": "https://www.omniglot.com/writing/phaistos.htm",
    "mark": "◉",
    "relatedLinks": [
      [
        "The Voynich manuscript",
        "Enter Yale’s guide to an illustrated manuscript whose strange writing has resisted a settled reading.",
        "https://beinecke.library.yale.edu/beinecke/collections/beinecke-cipher-voynich-manuscript",
        "Unresolved"
      ],
      [
        "Words beneath the words",
        "Discover how imaging recovered ancient mathematics erased beneath a medieval prayer book.",
        "https://www.archimedespalimpsest.org/",
        "Research"
      ],
      [
        "The Antikythera mechanism",
        "Investigate the intricate ancient mechanism recovered from a Mediterranean shipwreck.",
        "https://antikythera-mechanism.namuseum.gr/en/",
        "Research"
      ],
      [
        "Tesla in the FBI files",
        "Leaf through the FBI’s released files concerning Nikola Tesla and the questions surrounding his work.",
        "https://vault.fbi.gov/nikola-tesla",
        "Archive"
      ],
      [
        "The Devil’s Bible",
        "Explore the catalogue of the enormous medieval Codex Gigas, including its texts and illustrations.",
        "https://www.manuscripta.se/ms/100500",
        "Archive"
      ]
    ]
  },
  {
    "id": "babel",
    "name": "Book of letter grids",
    "website": "Library of Babel",
    "question": "Find your own sentence inside an apparently endless library.",
    "trail": "Search a sentence → locate its generated page → Borges’s story → infinity, probability, and meaning.",
    "description": "An open clothbound book filled with dense, mostly nonsensical letters and a few recognizable words, representing a mathematical literary experiment.",
    "evidence": "Mathematical & literary experiment",
    "url": "https://libraryofbabel.info/",
    "mark": "¶"
  },
  {
    "id": "internet-artifacts",
    "name": "Beige desktop computer",
    "website": "Neal.fun — Internet Artifacts",
    "question": "Meet the internet before it became familiar.",
    "trail": "ARPANET → early email → the first smiley → early websites and web culture.",
    "description": "A miniature beige computer with a chunky CRT monitor, tiny keyboard, and simple early-web screen: a small piece of internet archaeology.",
    "evidence": "Interactive historical exhibit",
    "url": "https://neal.fun/internet-artifacts/",
    "mark": "▣"
  },
  {
    "id": "optical-illusions",
    "name": "Impossible triangle",
    "website": "Michael Bach’s Optical Illusions",
    "question": "Why does your brain insist that this is moving?",
    "trail": "Apparent motion → impossible objects → disappearing shapes → how vision interprets the world.",
    "description": "A perspective sculpture arranged to resemble a continuous impossible triangle from its head-on viewing point. Some demonstrations on the website carry flicker notices; read those before opening them.",
    "evidence": "Interactive perception demonstrations",
    "url": "https://michaelbach.de/ot/",
    "mark": "△"
  },
  {
    "id": "unworkable-devices",
    "name": "Perpetual-motion wheel",
    "website": "Museum of Unworkable Devices",
    "question": "It looks like it should run forever. Why doesn’t it?",
    "trail": "Perpetual-motion proposals → overbalanced wheels → ingenious failed inventions → the physics that explains them.",
    "description": "A stationary wheel with offset weights and a small hand crank. The model illustrates a failed idea, not a source of endless energy.",
    "evidence": "Physics & invention history",
    "url": "https://dsimanek.vialattea.net/museum/unwork.htm",
    "mark": "◌"
  },
  {
    "id": "long-now",
    "name": "Five-digit-year clock",
    "website": "The Long Now Foundation",
    "question": "How do you build a clock meant to outlast civilizations?",
    "trail": "The 10,000-year clock → its mechanisms and chimes → long-term preservation → thinking in centuries.",
    "description": "An exposed-gear mechanical clock model with the year plate 02026. This is a symbolic display, not a claim that the shelf clock runs for 10,000 years.",
    "evidence": "Long-term engineering & culture",
    "url": "https://longnow.org/clock/",
    "mark": "◷",
    "relatedLinks": [
      [
        "The Versailles time slip",
        "Read the original account of two visitors who believed they entered an earlier Versailles; the claim remains unverified.",
        "https://www.gutenberg.org/ebooks/64809",
        "Story"
      ],
      [
        "Time, a millimeter apart",
        "Discover how atomic clocks measured time passing differently across a tiny change in height.",
        "https://www.nist.gov/news-events/news/2022/02/jila-atomic-clocks-measure-einsteins-general-relativity-millimeter-scale",
        "Research"
      ],
      [
        "Can time travel happen?",
        "Explore NASA’s explanation of time dilation, traveling clocks, and what the movies get wrong.",
        "https://spaceplace.nasa.gov/time-travel/en/",
        "Research"
      ]
    ]
  },
  {
    "id": "apollo",
    "name": "Apollo capsule model",
    "website": "Apollo in Real Time",
    "question": "Listen to a Moon mission as it unfolds.",
    "trail": "Apollo 11, 13, or 17 → mission audio → historical mission material → the decisions behind spaceflight.",
    "description": "A silver, cone-shaped Apollo command-module model on a dark stand, representing the missions in the archive.",
    "evidence": "Historical mission material",
    "url": "https://apolloinrealtime.org/",
    "mark": "⌂"
  },
  {
    "id": "ancient-earth",
    "name": "Pangaea globe",
    "website": "Ancient Earth",
    "question": "Where was your town hundreds of millions of years ago?",
    "trail": "Enter a city → move through geological time → Pangaea → shifting continents and ancient environments.",
    "description": "A small desk globe showing joined continents, a model of Earth’s changing geography.",
    "evidence": "Scientific reconstruction",
    "url": "https://dinosaurpictures.org/ancient-earth",
    "mark": "☉"
  },
  {
    "id": "onezoom",
    "name": "Tree-of-life sculpture",
    "website": "OneZoom",
    "question": "How are you related to a mushroom?",
    "trail": "Start with humans → shared ancestors → branches of animal life → plants and fungi.",
    "description": "A branching metal tree with tiny animal, leaf, and mushroom forms. Its branches symbolize evolutionary relationships.",
    "evidence": "Evolutionary tree explorer",
    "url": "https://www.onezoom.org/",
    "mark": "♧"
  },
  {
    "id": "earth-nullschool",
    "name": "Vortex bottle",
    "website": "Earth Nullschool",
    "question": "See the planet’s normally invisible movement.",
    "trail": "Global winds → different atmospheric levels → ocean currents → temperature patterns.",
    "description": "A sealed clear bottle containing a visible swirling funnel. It symbolizes circulating air and water; it is not a source of the website’s data.",
    "evidence": "Weather & ocean-data visualization",
    "url": "https://earth.nullschool.net/",
    "mark": "≈"
  },
  {
    "id": "zooniverse",
    "name": "Tabletop telescope",
    "website": "Zooniverse — Space Projects",
    "question": "Could you notice something a research team needs help finding?",
    "trail": "Space projects → Black Hole Hunters → astronomical observations → research discussions.",
    "description": "A short telescope on a miniature tripod, representing the astronomy route within a much broader public research platform.",
    "evidence": "Public participation in research",
    "url": "https://www.zooniverse.org/projects?discipline=space",
    "mark": "✧"
  }
];

export const shelfCuriosities = shelfEntries.map((entry, index) => {
  const side = index < 10 ? -1 : 1, bay = index % 5, tier = index % 10 < 5 ? 1 : 0;
  const z = [3.08, 2.29, 1.50, .71, -.08][bay];
  const position = [side * .205, tier ? 1.34 : .77, z];
  return { ...entry, number: index + 1, shelf: true, side, bay, tier,
    eyebrow: entry.website, title: entry.question, position,
    pose: [[side * 1.10, tier ? 1.48 : 1.12, z], [...position]],
    links: [[entry.website, entry.trail, entry.url, entry.evidence]] };
});

// Objects are invitations. Each destination is named before the visitor leaves.
export const curiosities=[
  {id:'maps',name:'Maps, folded into maps',mark:'⌁',eyebrow:'MAPS, MOSTLY. PERHAPS.',title:'Somewhere you have never been.',description:'Maps folded into maps. A compass without a needle. A corner of the world you could easily lose an afternoon in.',position:[1.64,.95,1.48],pose:[[1.05,1.5,3.25],[1.64,.95,1.48]],links:[
    ['Follow the ink','Historical maps in the David Rumsey collection.','https://www.davidrumsey.com/'],
    ['Find the world as it used to be','Explore places through OldMapsOnline.','https://www.oldmapsonline.org/'],
    ['Watch the invisible weather','Winds and currents moving around the globe.','https://earth.nullschool.net/']
  ]},
  {id:'bottles',name:'Cloudy bottles & specimens',mark:'♧',eyebrow:'THE LABELS HAVE FADED',title:'What on earth is that?',description:'A shell, a tooth, something pressed between two slips of paper. The world has been making peculiar things for a very long time.',position:[-2.05,1.55,.1],pose:[[-1.05,1.55,1.1],[-2.17,1.35,.1]],links:[
    ['Look beneath the surface','Descend through The Deep Sea, by Neal Agarwal.','https://neal.fun/deep-sea/'],
    ['Find something living','Browse nature observations on iNaturalist.','https://www.inaturalist.org/observations'],
    ['Help someone discover something','Explore research projects on Zooniverse.','https://www.zooniverse.org/projects']
  ]},
  {id:'sounds',name:'A horn that almost remembers',mark:'♫',eyebrow:'SOME THINGS STILL HAVE A VOICE',title:'Was that coming from here?',description:'The bells are still. Somewhere behind the boxes, a tune almost remembers itself.',position:[1.73,1.5,4.65],pose:[[0,1.6,6.3],[1.73,1.3,4.65]],links:[
    ['Turn the world like a dial','Explore live radio stations on Radio Garden.','https://radio.garden/'],
    ['One more song before you go','Live recordings at the Internet Archive.','https://archive.org/details/etree'],
    ['Listen to a place far away','Peer through someone else’s window on WindowSwap.','https://www.window-swap.com/']
  ]},
  {id:'sky',name:'A little world in brass rings',mark:'☉',eyebrow:'NO WINDOWS DOWN HERE',title:'Still, there is the sky.',description:'Brass rings. Tiny numbers worn almost smooth. Someone used this to find their way when the road ran out.',position:[2.01,1.18,-.82],pose:[[1.05,1.55,.7],[2.01,1.18,-.82]],links:[
    ['Turn the night overhead','An interactive star map from Stellarium Web.','https://stellarium-web.org/'],
    ['See what the sky offered today','NASA’s Astronomy Picture of the Day.','https://science.nasa.gov/apod/'],
    ['Open a box of distant light','Explore photographs and recordings from NASA.','https://images.nasa.gov/']
  ]},
  {id:'paper',name:'Unsorted papers',mark:'¶',eyebrow:'NO ONE FINISHED SORTING THESE',title:'One sentence, then another.',description:'Letters without envelopes. Stories without appointments. A page that may have been waiting for exactly this afternoon.',position:[-1.65,.8,3.45],pose:[[-.1,1.5,4.5],[-1.9,.85,3.45]],links:[
    ['Open at a page you did not choose','Let Wikipedia choose a random article.','https://en.wikipedia.org/wiki/Special:Random'],
    ['Take a story down from the shelf','Read a book at Project Gutenberg.','https://www.gutenberg.org/'],
    ['A library stranger than it first appears','Explore Jonathan Basile’s Library of Babel.','https://libraryofbabel.info/']
  ]},
  {id:'time',name:'Keys without their doors',mark:'∞',eyebrow:'SOMEONE ONCE CARED ABOUT THESE',title:'Nothing is only a thing.',description:'A chipped ornament. A machine that has forgotten the year. A picture of a place no one here remembers.',position:[1.20,1.5,-2.55],pose:[[.1,1.55,-1.1],[1.20,1.5,-2.55]],links:[
    ['Look at what people left behind','Explore objects and art in The Met collection.','https://www.metmuseum.org/art/collection'],
    ['Follow an old, peculiar idea','Wander through The Public Domain Review.','https://publicdomainreview.org/'],
    ['Wake an old machine','Explore the Internet Archive’s MS-DOS games.','https://archive.org/details/softwarelibrary_msdos_games']
  ]},
  ...shelfCuriosities
];
