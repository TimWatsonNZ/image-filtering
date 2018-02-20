
var img = new Image();
var url = 'http://localhost:3000/small-family.jpg';
img.src = url;

img.onload = function() {
  const canvas = document.createElement('canvas');
  const canvas_original = document.createElement('canvas');
  const width = img.width;
  const height = img.height;
  
  canvas.width=width;
  canvas.height=height;
  
  canvas_original.width=width;
  canvas_original.height=height;
  
  document.getElementById('root').appendChild(canvas);
  const ctx = canvas.getContext('2d');
  
  document.getElementById('root').appendChild(canvas_original);
  const ctx_original = canvas_original.getContext('2d');  

  ctx.drawImage(img, 0, 0);
  ctx_original.drawImage(img, 0, 0);


  var imageData = ctx.getImageData(0, 0, width, height);
  var pixels = imageData.data;

  const boxBlur = { 
    type: 'convolution',
    func: kernel3Function({
      v: [1, 1, 1, 1, 1, 1, 1, 1, 1], d: 9
    })
  }
  
  const identity = { 
    type: 'convolution',
    func: kernel3Function({
      v: [0, 0, 0, 0, 1, 0, 0, 0, 0], d: 1
    })
  }
  
  const edge1 = { 
    type: 'convolution',
    func: kernel3Function({
      v: [-1, -1, -1, -1, 8, -1, -1, -1, -1], d: 1
    })
  }
  
  const edge2 = { 
    type: 'convolution',
    func: kernel3Function({
      v: [1, 0, -1, 0, 0, 0, -1, 0, 1], d: 1
    })
  }
  
  const edge3 = { 
    type: 'convolution',
    func: kernel3Function({
      v: [0, 1, 0, 1, -4, 1, 0, 1, 0], d: 1
    })
  }
  
  const sharpen = { 
    type: 'convolution',
    func: kernel3Function(
      { v:[0, -1, 0, -1, 5, -1, 0, -1, 0], d: 1 } 
    ),
  }
  
  const gaussianBlur = { 
    type: 'convolution',
    func: kernel3Function({
      v: [1, 2, 1, 2, 4, 2, 1, 2, 1], d: 16
    })
  }
  // const lines = pipe(pixels, width, height, [desaturate, gaussianBlur, gaussianBlur, edge1, threshold(40), invert]);
  // const t = pipe(pixels, width, height, [threshold(128)]);

  let before = new Date();
  const downsampled = pipe(pixels, width, height, [median, gaussianBlur, contrastRgb(0.11)]);
  const clustered = pipe(randomlyCluster(downsampled, 16, 5), width, height, []);

  console.log("Time taken: ", new Date() - before);
  imageData.data.set(clustered);

  ctx.putImageData(imageData, 0, 0);
};

const randomlyCluster = (pixels, nClusters, iterations) => {
  const randomPosition = () => Math.floor(Math.random() * 255);
  const randomRgb = () => [randomPosition(), randomPosition(), randomPosition()];
  const clusters = [...Array(nClusters)].map(_ => randomRgb() );

  return cluster(pixels, clusters, iterations);
}

const cluster = (pixels, inputClusters, iterations) => {
  let clusters = inputClusters.map(c => ({ rgb: c, pixels: []}));
  
  const findDistance = (c, r) => {
    return Math.sqrt(Math.pow(c[0] - r[0], 2) + Math.pow(c[1] - r[1], 2), Math.pow(c[2] - r[2], 2));
  }

  const closest = (rgb, clusters) => {
    let closestDistance = Infinity;
    let closest = null;

    clusters.forEach(cluster => {
      let distance = findDistance(rgb, cluster.rgb);

      if (distance < closestDistance) {
        closestDistance = distance;
        closest = cluster;
      }
    });

    return closest;
  }
  
  const recalculateClusters = (clusters) => {
    const newClusters = [];

    //  Iterate cluster pixels and find avg position.
    clusters.forEach(cluster => {
      const avgRgb = { r: 0, g: 0, b: 0};

      cluster.pixels.forEach(pixel => {
        avgRgb.r += pixel.pixels[0];
        avgRgb.g += pixel.pixels[1];
        avgRgb.b += pixel.pixels[2];
      });

      avgRgb.r /= cluster.pixels.length;
      avgRgb.g /= cluster.pixels.length;
      avgRgb.b /= cluster.pixels.length;

      newClusters.push({ ...cluster, rgb: [avgRgb.r, avgRgb.g, avgRgb.b] });
    });

    return newClusters;
  }

  //  For each pixel find closest cluster.
  const assignPixelsToClusters = (pixels, clusters) => {
    
    for(let i=0;i<pixels.length;i+= 4) {
      let closestCluster = closest([pixels[i], pixels[i+1], pixels[i+2]], clusters);
      closestCluster.pixels.push({ index: i, pixels: [pixels[i], pixels[i+1], pixels[i+2]]});
    }  
  }

  //  For each cluster write pixels to buffer.
  const writeOutClustersToBuffer = (clusters) => {
    let buffer = [];

    clusters.forEach(cluster => {
      cluster.pixels.forEach(pixelGroup => {
        buffer[pixelGroup.index] =     cluster.rgb[0];
        buffer[pixelGroup.index + 1] = cluster.rgb[1];
        buffer[pixelGroup.index + 2] = cluster.rgb[2];
        buffer[pixelGroup.index + 3] = 255;
      });
    });

    return buffer;
  }

  let buffer = [...pixels];
  for(let i = 0;i<iterations;i++) {
    assignPixelsToClusters(buffer, clusters);
    if (iterations > 1) clusters = recalculateClusters(clusters);
  }

  buffer = writeOutClustersToBuffer(clusters);
  return buffer;
}

const combine = (pixelsA, pixelsB, interpolateA, interpolateB) => {
  let output = [];
  for(let i=0;i < pixelsA.length;i++) {
    output[i] = pixelsA[i] * interpolateA + pixelsB[i] * interpolateB;
  }
  return output;
}

const pipe = (pixels, width, height, fns) => {
  let buffer = [...pixels];
  fns.forEach(fn => {
    if (fn.type === 'convolution') {
      buffer = convulve(buffer, width, height, fn.func);
    } else {
      buffer = filter(buffer, width, height, fn.func);
    }
  });
  return buffer;
}

const median = {
  type: 'convolution',
  func: (area) => {
    const r = area.r.sort()[4];
    const g = area.g.sort()[4];
    const b = area.b.sort()[4];

    return {r, g, b};
  }
}

const threshold = (threshold) => ({
  type: 'filter',
  threshold,
  func: (pixels) => {
    return { 
      r: pixels[0] > threshold ? pixels[0] : 0,
      g: pixels[1] > threshold ? pixels[1] : 0,
      b: pixels[2] > threshold ? pixels[2] : 0,
    }
  }
});

const invert = ({
  type: 'filter',
  func: (pixels) => {
    return { 
      r: 255 - pixels[0],
      g: 255 - pixels[1],
      b: 255 - pixels[2],
    }
  }
});

const desaturate = {
  type: 'filter',
  func: (pixels) => {
    let highest = Math.max(
      Math.max(pixels[0], pixels[1]),
      Math.max(pixels[1], pixels[2])
    ); 
    return { 
      r: highest,
      g: highest,
      b: highest,
    }
  }
};

const contrastRgb = (scale) => ({
  type: 'filter',
  func: (pixels) => {
    return {
      r: pixels[0] > 128 ? pixels[0] * (1 + scale) : pixels[0] * (1-scale),
      g: pixels[1] > 128 ? pixels[1] * (1 + scale) : pixels[1] * (1-scale),
      b: pixels[2] > 128 ? pixels[2] * (1 + scale) : pixels[2] * (1-scale), 
    }
  }
});

const contrast = (scale) => ({
  type: 'filter',
  func: (pixels) => {
    if (Math.max(...pixels) > 128) {
      return {
        r: pixels[0] * (1 + scale),
        g: pixels[1] * (1 + scale),
        b: pixels[2] * (1 + scale), 
      }
    } else {
      return {
        r: pixels[0] * (1-scale),
        g: pixels[1] * (1-scale),
        b: pixels[2] * (1-scale), 
      }
    }
  }
});

const saturation = (scale) => ({
  type: 'filter',
  func: (pixels) => {
    if (pixels[0] > pixels[1] && pixels[0] > pixels[2]) {
      return { r: pixels[0] * (1 + scale), g: pixels[1] * (1-scale), b: pixels[2] * (1-scale) }
    }
    if (pixels[1] > pixels[0] && pixels[1] > pixels[2]) {
      return { r: pixels[0] * (1 - scale), g: pixels[1] * (1+scale), b: pixels[2] * (1-scale) }
    }
    return { r: pixels[0] * (1 - scale), g: pixels[1] * (1-scale), b: pixels[2] * (1+scale) }
  }
});

const constScale = (value) => ({
  type: 'filter',
  func: (pixels) => {
    return { 
      r: pixels[0] + value,
      g: pixels[1] + value,
      b: pixels[2] + value,
    }
  }
});

const rangeScale = (start, end, value) => ({
  type: 'filter',
  func: (pixels) => {
    let highest = Math.max(
      Math.max(pixels[0], pixels[1]),
      Math.max(pixels[1], pixels[2])
    ); 
    
    return { 
      r: pixels[0] > start && pixels[0] < end ? pixels[0] * value : pixels[0],
      g: pixels[1] > start && pixels[1] < end ? pixels[1] * value : pixels[1],
      b: pixels[2] > start && pixels[2] < end ? pixels[2] * value : pixels[2],
    }
  }
});

const linearScale = (value) => ({
  type: 'filter',
  func: (pixels) => {
    return { 
      r: pixels[0] * value,
      g: pixels[1] * value,
      b: pixels[2] * value,
    }
  }
});

const kernel3Function = (kernel) => (area) => {
  const r = area.r.reduce((p, c, i) => p += area.r[i]*kernel.v[i], 0)/kernel.d;
  const g = area.g.reduce((p, c, i) => p += area.g[i]*kernel.v[i], 0)/kernel.d;
  const b = area.b.reduce((p, c, i) => p += area.b[i]*kernel.v[i], 0)/kernel.d;

  return { r, g, b};
}

const filter = (pixels, width, height, fn) => {
  const buffer = [];
  for(let i = 0;i < pixels.length;i+=4) {
    const filtered = fn([pixels[i], pixels[i+1],pixels[i+2]]);
    buffer[i] =   filtered.r;
    buffer[i+1] = filtered.g;
    buffer[i+2] = filtered.b;
    buffer[i+3] = 255;

  }
  return buffer;
}

const convulve = (pixels, width, height, fn) => {
  const getIndex = (row, column, offset) => {
    return row * width * 4 + column * 4 + offset;
  }

  const getPixels = (row, column) => {
    return { 
      r: pixels[getIndex(row, column, 0)],
      g: pixels[getIndex(row, column, 1)],
      b: pixels[getIndex(row, column, 2)],
      a: pixels[getIndex(row, column, 3)],
    }
  }

  const buffer = [];

  for(let i = 0;i < pixels.length;i+=4) {
    const c = (i/4) % (width);
    const r = Math.floor((i/4) / (width));

    //  too lazy to process edges atm..
    if (c === 0 || c === width-1 || r == 0 || r === height-1) {
      buffer[i] =  pixels[i];
      buffer[i+1] = pixels[i+1];
      buffer[i+2] = pixels[i+2];
      buffer[i+3] = pixels[i+3];
      continue;
    };

    //  tl  tm  tr
    //  ml      mr
    //  bl  bm  br
    const tl = getPixels(r-1, c-1);
    const tm = getPixels(r-1, c);
    const tr = getPixels(r-1, c+1);

    const ml = {
      r: pixels[i - 4], g: pixels[i - 3], b: pixels[i - 2], a: pixels[i - 1]
    };

    const mr = { r: pixels[i + 4], g: pixels[i + 5], b: pixels[i + 6], a: pixels[i + 7] };

    const bl = getPixels(r+1, c-1);
    const bm = getPixels(r+1, c);
    const br = getPixels(r+1, c + 1);

    const convolution = fn({ r: [tl.r, tm.r, tr.g, ml.r, pixels[i],   mr.r, bl.r, bm.r, br.r ],
                             g: [tl.g, tm.g, tr.g, ml.g, pixels[i+1], mr.g, bl.g, bm.g, br.g ],
                             b: [tl.b, tm.b, tr.b, ml.b, pixels[i+2], mr.b, bl.b, bm.b, br.b ]});

    buffer[i] =   convolution.r;  //(tl.r*k.tl + tm.r*k.tm + tr.r*k.tr + ml.r*k.ml + mr.r*k.mr + bl.r*k.bl + bm.r*k.bm + br.r*k.br + pixels[i]  *k.p)/k.d;
    buffer[i+1] = convolution.g;  //(tl.g*k.tl + tm.g*k.tm + tr.g*k.tr + ml.g*k.ml + mr.g*k.mr + bl.g*k.bl + bm.g*k.bm + br.g*k.br + pixels[i+1]*k.p)/k.d;
    buffer[i+2] = convolution.b;  //(tl.b*k.tl + tm.b*k.tm + tr.b*k.tr + ml.b*k.ml + mr.b*k.mr + bl.b*k.bl + bm.b*k.bm + br.b*k.br + pixels[i+2]*k.p)/k.d;
    buffer[i+3] = 255;

  }
  return buffer;
}