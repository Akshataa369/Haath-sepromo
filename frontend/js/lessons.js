// The fixed Haath Se curriculum, the legal provisions shown before learning,
// and the awareness facts that unlock as you learn.
// Sign IDs must match SIGN_IDS in backend/server.py.

export const ISLRTC_URL = "https://islrtc.nic.in/";

const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ id: "n" + n, label: String(n), name: `Number ${n}` }));
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(c => ({ id: "l" + c.toLowerCase(), label: c, name: `Letter ${c}` }));

// 30 everyday expressions used in conversations everywhere. Sign languages differ
// between countries, so Haath Se teaches the ISL version of each, as ISLRTC does.
const EXPRESSION_WORDS = [
  "Hello", "Welcome", "Good morning", "Good night", "Thank you", "Please",
  "Sorry", "Yes", "No", "Good", "Bad", "Help",
  "Stop", "Wait", "Come", "Go", "Again", "Understand",
  "Name", "Eat", "Drink", "Hungry", "Thirsty", "Home",
  "School", "Friend", "Mother", "Father", "Happy", "Bye",
];
const EXPRESSIONS = EXPRESSION_WORDS.map(w => ({ id: "e-" + w.toLowerCase().replace(/\s+/g, "-"), label: w, name: w }));

export const UNITS = [
  { id: "numbers", title: "Numbers", range: "1 to 9", note: "A good place to start: most ISL numbers use one hand.", signs: NUMBERS },
  { id: "alphabet", title: "Alphabet", range: "A to Z", note: "Most ISL letters use both hands, so keep both in view.", signs: LETTERS },
  {
    id: "expressions", title: "Expressions", range: "30 everyday words",
    note: "Words people use every day, everywhere, in their ISL form. Watch the animated figure for the movement; the camera checks the key hand shape. These animations come from a community ISL avatar project, so confirm them with ISLRTC.",
    signs: EXPRESSIONS,
  },
];

export const ALL_SIGNS = UNITS.flatMap(u => u.signs.map(s => ({ ...s, unit: u.id })));
export const signById = id => ALL_SIGNS.find(s => s.id === id);

// ---------------------------------------------------------------------------
// Legal provisions. Summaries for awareness, not legal advice.
export const LAW_SOURCES = {
  rpwd: "https://indiacode.nic.in/bitstream/123456789/15939/1/the_rights_of_persons_with_disabilities_act%2C_2016.pdf",
  nep: "https://dsel.education.gov.in/sites/default/files/update/Nep_2020.pdf",
  crpd: "https://www.un.org/development/desa/disabilities/convention-on-the-rights-of-persons-with-disabilities.html",
};

export const LAWS = [
  {
    ref: "RPwD Act, 2016",
    title: "The Rights of Persons with Disabilities Act",
    body: "India's main disability rights law, in force since 19 April 2017. It replaced the 1995 Act, recognises 21 disabilities (up from 7) and gives effect to the UN Convention on the Rights of Persons with Disabilities, which India ratified in 2007. It defines \"deaf\" as a hearing loss of 70 dB or more in the speech frequencies in both ears, and \"hard of hearing\" as 60 to 70 dB.",
    source: "rpwd",
  },
  {
    ref: "Section 3",
    title: "Equality and non-discrimination",
    body: "The government must ensure that persons with disabilities enjoy the right to equality and a life with dignity, equally with others. No one may be discriminated against because of their disability unless it is shown to be a proportionate means of achieving a legitimate aim.",
    source: "rpwd",
  },
  {
    ref: "Section 16(v)",
    title: "Education in the right language",
    body: "Schools must ensure that deaf and blind learners are taught \"in the most appropriate languages and modes and means of communication\". For many Deaf children, that language is ISL.",
    source: "rpwd",
  },
  {
    ref: "Section 17(c)",
    title: "Teachers who know sign language",
    body: "The government must train and employ teachers qualified in sign language and Braille, including teachers who themselves have a disability.",
    source: "rpwd",
  },
  {
    ref: "Section 42",
    title: "Access to TV and online media",
    body: "Electronic media must be made accessible, including through \"sign language interpretation and close captioning\", along with audio description and accessible formats.",
    source: "rpwd",
  },
  {
    ref: "Sections 32 and 34",
    title: "Seats and jobs",
    body: "At least 5% of seats in government and government-aided higher education institutions are reserved for persons with benchmark disabilities. In government jobs, 4% of vacancies are reserved, with 1% set aside for people who are deaf or hard of hearing.",
    source: "rpwd",
  },
  {
    ref: "NEP 2020, para 4.22",
    title: "Standardising Indian Sign Language",
    body: "The National Education Policy commits to standardising ISL across the country and developing national and state curriculum materials for Deaf students.",
    source: "nep",
  },
  {
    ref: "UN CRPD, Articles 21 and 24",
    title: "Sign language as a right",
    body: "The UN Convention asks countries to recognise and promote the use of sign languages, and to make it easier to learn sign language and to promote the linguistic identity of the Deaf community.",
    source: "crpd",
  },
];

// ---------------------------------------------------------------------------
// Awareness facts. One unlocks for every sign you learn.
export const FACTS = [
  {
    title: "Over 50 lakh people",
    body: "The 2011 Census counted 5,072,914 people in India with a hearing disability, and 1,998,692 with a speech disability.",
    source: { label: "Census 2011 via National Health Profile", url: "https://cbhidghs.mohfw.gov.in/Ebook/National%20Health%20Profile-2018%20(e-Book)/files/assets/basic-html/page-181.html" },
  },
  {
    title: "A language of its own",
    body: "ISL is a full language with its own grammar and vocabulary. It is not Hindi or English spelled out with the hands.",
  },
  {
    title: "Say \"Deaf\", not \"deaf and dumb\"",
    body: "Many Deaf people can and do use their voice. Words like \"dumb\" and \"mute\" are hurtful and inaccurate. Use \"Deaf\" or \"hard of hearing\", or ask the person what they prefer.",
  },
  {
    title: "ISLRTC since 2015",
    body: "The Indian Sign Language Research and Training Centre was set up on 28 September 2015 under the Department of Empowerment of Persons with Disabilities, to research, teach and promote ISL.",
    source: { label: "ISLRTC Annual Report 2023-24", url: "https://divyangjan.depwd.gov.in/upload/s3wassupload/ISLRTC_New_Delhi_Annual_Report_2023_24.pdf" },
  },
  {
    title: "Getting someone's attention",
    body: "Wave gently where the person can see you, or tap them lightly on the shoulder. Don't shout from behind.",
  },
  {
    title: "10,000 signs and growing",
    body: "ISLRTC's ISL dictionary has 10,000 terms in its 2021 edition, and it keeps being updated.",
    source: { label: "ISLRTC Annual Report 2023-24", url: "https://divyangjan.depwd.gov.in/upload/s3wassupload/ISLRTC_New_Delhi_Annual_Report_2023_24.pdf" },
  },
  {
    title: "Face the person",
    body: "Many people lip-read alongside signing. Face them, keep your mouth visible, and speak at a normal pace without exaggerating or shouting.",
  },
  {
    title: "23 September",
    body: "The UN General Assembly proclaimed 23 September the International Day of Sign Languages in December 2017. ISLRTC celebrates it as Sign Language Day.",
    source: { label: "ISLRTC Annual Report 2023-24", url: "https://divyangjan.depwd.gov.in/upload/s3wassupload/ISLRTC_New_Delhi_Annual_Report_2023_24.pdf" },
  },
  {
    title: "An ISL TV channel",
    body: "PM eVIDYA DTH channel 31, dedicated to ISL learning content for students and teachers, launched on 6 December 2024. The government said over 10,000 words had been standardised.",
    source: { label: "Ministry of Education press release", url: "https://dsel.education.gov.in/sites/default/files/update/PIB2081612.pdf" },
  },
  {
    title: "Ask for captions and interpreters",
    body: "Section 42 of the RPwD Act says electronic media should offer sign language interpretation and closed captions. You can ask broadcasters and platforms for them.",
    source: { label: "RPwD Act, 2016", url: LAW_SOURCES.rpwd },
  },
  {
    title: "Measured in decibels",
    body: "Under the RPwD Act, \"deaf\" means a loss of 70 dB or more in the speech frequencies in both ears, and \"hard of hearing\" means 60 to 70 dB.",
    source: { label: "RPwD Act, 2016, Schedule", url: LAW_SOURCES.rpwd },
  },
  {
    title: "Write it down",
    body: "If you don't know the sign, it's fine to write, type or point. Being patient matters more than being perfect.",
  },
  {
    title: "Keep going",
    body: "ISLRTC offers an online self-learning course for ISL, launched on Sign Language Day 2023. Haath Se is a first step; learn from Deaf teachers next.",
    source: { label: "ISLRTC", url: ISLRTC_URL },
  },
];
