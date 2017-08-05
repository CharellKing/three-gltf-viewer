const EventEmitter = require('events');
const zip = window.zip = require('zipjs-browserify');

require('./lib/zip-fs');

/**
 * Watches an element for file drops, parses to create a filemap hierarchy,
 * and emits the result.
 */
class DropController extends EventEmitter {

  /**
   * @param  {Element} el
   */
  constructor (el) {
    super();
    this.el = el;
    el.addEventListener('dragover', (e) => this.onDragOver(e), false);
    el.addEventListener('drop', (e) => this.onDrop(e), false);
  }

  /**
   * @param  {Event} e
   */
  onDrop (e) {
    e.stopPropagation();
    e.preventDefault();

    this.emit('dropstart');

    let entries;
    if (e.dataTransfer.items) {
      entries = [].slice.call(e.dataTransfer.items)
        .map((item) => item.webkitGetAsEntry());
    } else if ((e.dataTransfer.files||[]).length === 1) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/zip') {
        this.loadZip(file);
        return;
      }
    }

    if (!entries) {
      this.fail(''
        + 'Required drag-and-drop APIs are not supported in this browser. '
        + 'Please try Chrome, Firefox, Microsoft Edge, or Opera.'
      );
    }

    if (entries.length === 1 && entries[0].name.match(/\.zip$/)) {
      entries[0].file((file) => this.loadZip(file));
    } else {
      this.loadNextEntry(new Map(), entries);
    }
  }

  /**
   * @param  {Event} e
   */
  onDragOver (evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
  }

  /**
   * Iterates through a list of FileSystemEntry objects, creates the fileMap
   * tree, and emits the result.
   * @param  {Map<string, File>} fileMap
   * @param  {Array<FileSystemEntry>} entries
   */
  loadNextEntry (fileMap, entries) {
    const entry = entries.pop();

    if (!entry) {
      this.emitResult(fileMap);
      return;
    }

    if (entry.isFile) {
      entry.file((file) => {
        fileMap.set(entry.fullPath, file);
        this.loadNextEntry(fileMap, entries);
      }, () => console.error('Could not load file: %s', entry.fullPath));
    } else if (entry.isDirectory) {
      entry.createReader().readEntries((directoryEntries) => {
        this.loadNextEntry(fileMap, entries.concat(directoryEntries));
      });
    } else {
      console.warn('Unknown asset type: ' + entry.fullPath);
      this.loadNextEntry(fileMap, entries);
    }
  }

  /**
   * Inflates a File in .ZIP format, creates the fileMap tree, and emits the
   * result.
   * @param  {File} file
   */
  loadZip (file) {
    const pending = [];
    const fileMap = new Map();
    const archive = new zip.fs.FS();

    const traverse = (node) => {
      if (node.directory) {
        node.children.forEach(traverse);
      } else if (node.name[0] !== '.') {
        pending.push(new Promise((resolve) => {
          node.getData(new zip.BlobWriter(), (blob) => {
            blob.name = node.name;
            fileMap.set(node.getFullname(), blob);
            resolve();
          });
        }));
      }
    };

    archive.importBlob(file, () => {
      traverse(archive.root);
      Promise.all(pending).then(() => {
        this.emitResult(fileMap);
      });
    });
  }

  /**
   * @param {Map<string, File>} fileMap
   */
  emitResult (fileMap) {
    let rootFile;
    let rootPath;
    fileMap.forEach((file, path) => {
      if (file.name.match(/\.(gltf|glb)$/)) {
        rootFile = file;
        rootPath = path.replace(file.name, '');
      }
    });

    if (!rootFile) {
      this.fail('No .gltf or .glb asset found.');
    }

    this.emit('drop', {
      rootFile: rootFile,
      rootPath: rootPath,
      fileMap: fileMap
    });
  }

  fail (message) {
    window.alert(message);
    this.emit('droperror', {message: message});
    throw new Error(message);
  }
}

module.exports = DropController;
