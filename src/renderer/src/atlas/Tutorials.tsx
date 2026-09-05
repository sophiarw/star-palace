import { useState } from 'react'
import { Modal } from './Modal'
import { TUTORIALS } from './tutorialCatalog'

export function TutorialLink({ topic }: { topic: string }) {
  return <button className="atlas-text-button" onClick={() => window.dispatchEvent(new CustomEvent('starpalace-tutorial', { detail: topic }))}>Tutorial ↗</button>
}
export function Tutorials({ initial = 'sources', onClose }: { initial?: string; onClose: () => void }) {
  const [id, setId] = useState(initial)
  const tutorial = TUTORIALS.find(t => t.id === id) ?? TUTORIALS[0]
  const image = '/tutorials/' + tutorial.image + '.png'
  return <Modal title="Tutorials" onClose={onClose}><div className="atlas-tutorial">
    <label>Feature<select aria-label="Tutorial feature" value={tutorial.id} onChange={e => setId(e.target.value)}>{TUTORIALS.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
    <h3>{tutorial.title}</h3><ol>{tutorial.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <figure><a href={image} target="_blank" rel="noreferrer" title="Open full-size screenshot"><img src={image} alt={tutorial.alt} /></a><figcaption>Fictional demo library · Select the screenshot to view it full size.</figcaption></figure>
  </div></Modal>
}
