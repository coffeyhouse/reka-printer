import { useEffect, useState } from 'react'
import { listPictures, PAGE, type Picture } from '../lib/api'
import { shapeById } from '../lib/catalog'
import { mediaUrl } from '../lib/supabase'

interface Props {
  spaceId: string
  open: boolean
  onClose: () => void
  onPick: (picture: Picture) => void
}

/** Every picture the boys have made, newest first. Tap one to print it again. */
export default function Gallery({ spaceId, open, onClose, onPick }: Props) {
  const [pictures, setPictures] = useState<Picture[] | null>(null)
  const [more, setMore] = useState(false)
  const [problem, setProblem] = useState(false)

  async function load(from: number) {
    try {
      const page = await listPictures(spaceId, from)
      setPictures((before) => (from === 0 ? page : [...(before ?? []), ...page]))
      setMore(page.length === PAGE)
      setProblem(false)
    } catch {
      setProblem(true)
    }
  }

  // Fresh each time it opens, so the picture just drawn is there.
  useEffect(() => {
    if (open) void load(0)
  }, [open, spaceId])

  return (
    <>
      <div className={open ? 'scrim open' : 'scrim'} onClick={onClose} />
      <div className={open ? 'sheet open' : 'sheet'} role="dialog" aria-label="My pictures" inert={!open}>
        <div className="grab" />
        <div className="sheet-head">
          <h3>My pictures</h3>
          <button className="done" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="grid">
          {problem && <p className="grid-note">Couldn't get the pictures. Check the internet and try again.</p>}
          {!problem && pictures?.length === 0 && <p className="grid-note">No pictures yet. Draw one!</p>}
          {open && pictures?.map((picture) => <Tile key={picture.id} spaceId={spaceId} picture={picture} onPick={onPick} />)}
        </div>
        {more && (
          <button className="ghost" onClick={() => void load(pictures?.length ?? 0)}>
            More pictures
          </button>
        )}
      </div>
    </>
  )
}

function Tile({ spaceId, picture, onPick }: { spaceId: string; picture: Picture; onPick: (picture: Picture) => void }) {
  const { print_path: printPath, width, height } = picture
  const across = shapeById(picture.shape).rotate
  // The print version of a Wide, Banner or Long picture runs down the paper:
  // turn it back so it reads the right way up.
  const turned = across && Boolean(printPath && width && height)
  const sized = Boolean(printPath && width && height)
  const frame = !sized ? undefined : turned ? { aspectRatio: `${height} / ${width}` } : { aspectRatio: `${width} / ${height}` }
  const img = turned ? { width: `${(width! / height!) * 100}%`, height: `${(height! / width!) * 100}%` } : undefined
  return (
    <button
      className={`tile${across ? ' across' : ''}${turned ? ' turned' : ''}`}
      onClick={() => onPick(picture)}
      aria-label={`Open: ${picture.idea}`}
    >
      <span className="frame" style={frame}>
        <img src={mediaUrl(spaceId, printPath ?? picture.original_path)} alt="" loading="lazy" style={img} />
      </span>
    </button>
  )
}
