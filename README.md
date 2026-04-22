# Addiction — AI Reliance Test

**Live demo:** https://addiction-mz12.onrender.com

**Author:** Aaron Jiang  
**Project:** Addiction  

Addiction is a small interactive web artwork that probes how “efficiency” can slowly turn thinking into something people avoid.  
Instead of treating AI reliance as simple fascination, the project frames dependency as a habit built through repeated cognitive outsourcing: when uncertainty and effort are delegated to computational systems, the user may shift from active thinking to result-checking.
---

## What you do
You will see 10 short scenario prompts. Each round you choose:

- **Think Myself** (solve without AI)
- **Ask AI** (delegate to AI)

The brain visualization changes when you pick **Ask AI**. At the end, you receive an **AI Addiction Rate** based on how often you relied on AI.

---

## Public summary (anonymous)
This version records only the **final percentage band** (0–9%, 10–19%, …, 90–100) and the total number of runs.  
No personal text, no prompts, no identifiers are stored.

---


## Screenshots

**Cover screen**
![Cover](./docs/cover.png)

**Test 01**
![Test 01](./docs/test-01.png)

**Test 02**
![Test 02](./docs/test-02.png)

**Result + public distribution**
![Result](./docs/result.png)

---

## Tech stack
- Frontend: p5.js + vanilla JS + CSS  
- Backend: Node.js (Express)  
- Optional prompts: OpenAI API via server-side key (not exposed to the client)

---

## Run locally

1) Install
```bash
npm install
```
2) Create
OPENAI_API_KEY=your_key_here
PORT=3000
3) Start
```bash
node app.js
```

---

---

## References

Clark, A. (2008) *Supersizing the mind: Embodiment, action, and cognitive extension*. Oxford: Oxford University Press.  
Available at: https://global.oup.com/academic/product/supersizing-the-mind-9780195333213

Citton, Y. (2017) *The ecology of attention*. Cambridge: Polity Press.  
Available at: https://politybooks.com/bookdetail/?isbn=9781509504327

Foucault, M. (2008) *The birth of biopolitics: Lectures at the Collège de France, 1978–1979*. Translated by G. Burchell. Basingstoke: Palgrave Macmillan.  
Available at: https://link.springer.com/book/10.1057/9780230594180

Han, B.-C. (2017) *Psychopolitics: Neoliberalism and new technologies of power*. Translated by E. Butler. London: Verso.  
Available at: https://www.versobooks.com/products/2310-psychopolitics

Hayles, N.K. (2017) ‘Cognitive assemblages: Technical agency and human interactions’, *Critical Inquiry*, 43(1), pp. 32–55.  
Available at: https://www.journals.uchicago.edu/doi/10.1086/689565

Schüll, N.D. (2012) *Addiction by design: Machine gambling in Las Vegas*. Princeton: Princeton University Press.  
Available at: https://press.princeton.edu/books/paperback/9780691160887/addiction-by-design

Simon, H.A. (1971) ‘Designing organizations for an information-rich world’, in Greenberger, M. (ed.) *Computers, communications, and the public interest*. Baltimore: Johns Hopkins University Press, pp. 37–52.  
Available at: https://repository.cmu.edu/cgi/viewcontent.cgi?article=1284&context=gsia

Stiegler, B. (1998) *Technics and time, 1: The fault of Epimetheus*. Translated by R. Beardsworth and G. Collins. Stanford: Stanford University Press.  
Available at: https://www.sup.org/books/title/?id=2326

Storm, B.C., Stone, S.M. and Benjamin, A.S. (2017) ‘Using the Internet to access information inflates future use of the Internet to access other information’, *Memory*, 25(6), pp. 717–723.  
Available at: https://doi.org/10.1080/09658211.2016.1210171

Winner, L. (1980) ‘Do artifacts have politics?’, *Daedalus*, 109(1), pp. 121–136.  
Available at: https://www.jstor.org/stable/20024652