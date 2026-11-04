import { createProject, makeComponent } from './factory';
import { addComponent, connectPins } from './operations';
import type { ComponentInstance, Project, ProjectType, PropertyValue, Rotation, Vec2 } from './types';

/**
 * Small fluent builder used by examples, the assistant, importers and tests.
 * It only calls the public model operations, so it exercises the same code paths as the UI.
 */
export class ProjectBuilder {
  project: Project;
  constructor(type: ProjectType | Project, name = 'Untitled project') {
    this.project = typeof type === 'string' ? createProject(type, name) : type;
  }

  add(type: string, at: Vec2, props: Record<string, PropertyValue> = {}, opts: { rotation?: Rotation; ref?: string; elevation?: number } = {}): ComponentInstance {
    const c = makeComponent(this.project, type, at, { rotation: opts.rotation ?? 0 });
    c.properties = { ...c.properties, ...props };
    if (opts.ref) c.ref = opts.ref;
    if (opts.elevation !== undefined) c.elevation = opts.elevation;
    this.project = addComponent(this.project, c);
    return this.project.components[c.id];
  }

  wire(a: ComponentInstance, pa: string, b: ComponentInstance, pb: string, vertices?: Vec2[]): this {
    this.project = connectPins(this.project, { componentId: a.id, pinId: pa }, { componentId: b.id, pinId: pb }, vertices);
    return this;
  }

  build(): Project {
    return this.project;
  }
}
