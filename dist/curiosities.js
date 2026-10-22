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
  {id:'cia',name:'Sealed dossiers',mark:'▤',eyebrow:'CIA FILES & STRANGE QUESTIONS',title:'The ink has finally dried.',description:'A clasped bundle of files. Crossed-out names. Open hearings, unusual experiments, and records that took years to reach the daylight.',shelf:true,side:-1,position:[-.23,1.13,2.83],pose:[[-1.1,1.55,3.01],[-.23,1.13,2.83]],links:[
    ['MKULTRA: the hearing','Open the 1977 Senate hearing into the CIA’s secret behavior-modification program.','https://www.intelligence.senate.gov/1977/08/03/hearings-joint-hearing-subcommittee-health-and-scientific-research-committee-human-resources-project/','Archive'],
    ['Stargate & psychic spies','Follow the CIA’s account of remote-viewing research and why it declined to restart the program.','https://www.cia.gov/stories/story/ask-molly-did-cia-really-study-psychic-powers/','Archive'],
    ['The Gateway assessment','Read the Army’s 1983 assessment of altered consciousness: an archived proposal, not proof of its claims.','https://www.govinfo.gov/app/details/GOVPUB-D101-PURL-gpo152943','Archive'],
    ['The Family Jewels','Unseal CIA records of activities that raised legal and ethical questions inside the agency.','https://nsarchive2.gwu.edu/NSAEBB/NSAEBB222/index.htm','Archive']
  ]},
  {id:'darpa',name:'Machines from tomorrow',mark:'⚙',eyebrow:'DARPA’S EXPERIMENTAL WORKSHOP',title:'Someone actually tried this.',description:'A small brass machine beside a stack of plans. Ships without crews, robots beneath the earth, and the long journey from an unlikely idea to an experiment.',shelf:true,side:-1,position:[-.23,1.13,1.50],pose:[[-1.1,1.55,1.68],[-.23,1.13,1.50]],links:[
    ['Brains & machines','Explore a DARPA research program designed to translate between neurons and electronics.','https://www.darpa.mil/research/programs/neural-engineering-system-design','Research'],
    ['Sea Hunter','Meet the experimental ship designed for long ocean journeys without a crew aboard.','https://www.darpa.mil/news/2018/sea-hunter-prototype','Research'],
    ['Robots underground','Follow autonomous robots into tunnels, caves, and unfamiliar underground spaces.','https://www.darpa.mil/research/challenges/subterranean','Research'],
    ['DARPA’s invention trail','Wander through decades of projects spanning satellites, stealth aircraft, computers, and stranger ideas.','https://www.darpa.mil/about/innovation-timeline','Research']
  ]},
  {id:'time-slips',name:'The stopped clock',mark:'◷',eyebrow:'TIME SLIPS & TRAVELING CLOCKS',title:'What year did you say it was?',description:'A small clock, stopped between hours. A story from the gardens of Versailles. Beside it, the experiments that show how strangely real clocks can behave.',shelf:true,side:-1,position:[-.23,1.13,.17],pose:[[-1.1,1.55,.35],[-.23,1.13,.17]],links:[
    ['The Versailles time slip','Read the original account of two visitors who believed they entered an earlier Versailles; the claim remains unverified.','https://www.gutenberg.org/ebooks/64809','Story'],
    ['Time, a millimeter apart','Discover how atomic clocks measured time passing differently across a tiny change in height.','https://www.nist.gov/news-events/news/2022/02/jila-atomic-clocks-measure-einsteins-general-relativity-millimeter-scale','Research'],
    ['Can time travel happen?','Explore NASA’s explanation of time dilation, traveling clocks, and what the movies get wrong.','https://spaceplace.nasa.gov/time-travel/en/','Research']
  ]},
  {id:'ufo',name:'The sky-watch box',mark:'◉',eyebrow:'SIGHTINGS, RECORDS & OPEN QUESTIONS',title:'Someone saw something.',description:'A little metal shape. A folder of sightings. Start with the records, follow the questions, and see how much a single piece of evidence can tell you.',shelf:true,side:1,position:[.23,1.13,2.83],pose:[[1.1,1.55,3.01],[.23,1.13,2.83]],links:[
    ['Project Blue Book','Enter the National Archives guide to the Air Force’s decades of UFO investigations.','https://www.archives.gov/research/military/air-force/ufos','Archive'],
    ['The flying-saucer memo','Read the FBI’s account of the famous Hottel memo and the unconfirmed story it preserved.','https://www.fbi.gov/news/stories/ufos-and-the-guy-hottel-memo','Story'],
    ['NASA looks at UAP','See how NASA approaches unexplained sightings, evidence, and the search for better data.','https://science.nasa.gov/uap/','Research'],
    ['Deeper into the UFO archive','Browse government records on sightings and investigations across multiple agencies.','https://www.archives.gov/research/topics/uaps/textual-and-microfilm','Archive']
  ]},
  {id:'ciphers',name:'The cipher book',mark:'⁂',eyebrow:'UNREADABLE, ERASED & HIDDEN',title:'There is something written here.',description:'A book of unfamiliar letters. A copper fragment. Some messages waited centuries to be read; others still invite another pair of eyes.',shelf:true,side:1,position:[.23,1.13,1.50],pose:[[1.1,1.55,1.68],[.23,1.13,1.50]],links:[
    ['The Voynich manuscript','Enter Yale’s guide to an illustrated manuscript whose strange writing has resisted a settled reading.','https://beinecke.library.yale.edu/beinecke/collections/beinecke-cipher-voynich-manuscript','Unresolved'],
    ['Kryptos','Inspect the coded copper sculpture that has kept cryptanalysts busy for decades.','https://www.cia.gov/legacy/museum/artifact/kryptos/','Archive'],
    ['NSA’s secret histories','Browse codebreaking histories, cipher machines, cryptologic puzzles, and declassified accounts.','https://www.nsa.gov/History/Cryptologic-History/Historical-Publications/','Archive'],
    ['Words beneath the words','Discover how imaging recovered ancient mathematics erased beneath a medieval prayer book.','https://www.archimedespalimpsest.org/','Research']
  ]},
  {id:'artifacts',name:'The cabinet of curious things',mark:'⌘',eyebrow:'OBJECTS WITH LONG SHADOWS',title:'Every object opens another door.',description:'A worn fragment held in brass rings. Ancient mechanisms, an inventor’s papers, and a book too large for an ordinary shelf. Follow each one into the history it carries.',shelf:true,side:1,position:[.23,1.13,.17],pose:[[1.1,1.55,.35],[.23,1.13,.17]],links:[
    ['The Antikythera mechanism','Investigate the intricate ancient mechanism recovered from a Mediterranean shipwreck.','https://antikythera-mechanism.namuseum.gr/en/','Research'],
    ['Tesla in the FBI files','Leaf through the FBI’s released files concerning Nikola Tesla and the questions surrounding his work.','https://vault.fbi.gov/nikola-tesla','Archive'],
    ['The Devil’s Bible','Explore the catalogue of the enormous medieval Codex Gigas, including its texts and illustrations.','https://www.manuscripta.se/ms/100500','Archive']
  ]}
];
