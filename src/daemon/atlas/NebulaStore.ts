import type { FileIndex } from '../db/FileIndex'
import type { AtlasNebula } from '../../shared/atlas'
import { nebulaGroups, type NebulaEdge, type NebulaPoint } from './nebulaGroups'

/** Versioned, recoverable presentation cache; neither groups nor colors are user metadata. */
export class NebulaStore {
  private cached: { epoch: number; groups: AtlasNebula[] } | null = null
  constructor(private readonly index: FileIndex) {
    index.db.exec(`
      CREATE TABLE IF NOT EXISTS atlas_nebula_state(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL DEFAULT 1);
      INSERT OR IGNORE INTO atlas_nebula_state(id) VALUES(1);
    `)
    // Invalidate on real evidence/geometry changes, not text extraction or favorite toggles.
    for (const [name, event] of [
      ['file_insert', 'INSERT ON files'], ['file_delete', 'DELETE ON files'],
      ['file_update', 'UPDATE OF content_hash,size,embedding ON files'],
      ['position_insert', 'INSERT ON atlas_positions'], ['position_delete', 'DELETE ON atlas_positions'],
      ['position_update', 'UPDATE OF x,y ON atlas_positions'],
      ['edge_insert', 'INSERT ON edges'], ['edge_delete', 'DELETE ON edges'], ['edge_update', 'UPDATE ON edges'],
    ]) index.db.exec(`CREATE TRIGGER IF NOT EXISTS atlas_nebula_${name} AFTER ${event} BEGIN UPDATE atlas_nebula_state SET epoch=epoch+1 WHERE id=1; END;`)
  }

  get epoch(): number { return (this.index.db.prepare('SELECT epoch FROM atlas_nebula_state WHERE id=1').get() as { epoch: number }).epoch }

  groups(visibleIds: Set<string>): AtlasNebula[] {
    const epoch = this.epoch
    if (!this.cached || this.cached.epoch !== epoch) {
      const points = this.index.db.prepare('SELECT f.id,p.x,p.y,f.size,f.content_hash contentHash FROM files f JOIN atlas_positions p ON p.id=f.id ORDER BY f.id').all() as NebulaPoint[]
      const edges = this.index.db.prepare("SELECT src_id src,dst_id dst,weight FROM edges WHERE engine='embedding' AND weight>=.92 ORDER BY weight DESC,src_id,dst_id LIMIT 100000").all() as NebulaEdge[]
      this.cached = { epoch, groups: nebulaGroups(points, edges) }
    }
    return this.cached.groups.map(group => ({ ...group, members: group.members.filter(p => visibleIds.has(p.id)) })).filter(group => group.members.length >= 3)
  }
}
