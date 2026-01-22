# fast-index-of-all

A fast `indexOfAll()` using WebAssembly. Currently based on [`libsais`](https://github.com/IlyaGrebnov/libsais).

> This package was initially created for [`patch-porter`](https://github.com/Coxxs/patch-porter).

## Usage

```javascript
import { createIndex, indexOfAll, freeIndex } from 'fast-index-of-all'

const handle = await createIndex(buffer)
const positions = indexOfAll(handle, needle)
freeIndex(handle) // When done
```