# imaginary-map

Once a month or so, I'm going to ask [Midjourney](https://midjourney.com/) to
imagine something bound to geography and then visualize the results on a map.

Images below are preview of the results, but please do explore interactive versions
as they provide more details with panning and zooming.

## Imagine historical figure in cyberpunk settings

[link](https://anvaka.github.io/imaginary-map/cyberpunk/)

## Imagine Futuristic Architecture of `X`

[![preview](https://anvaka.github.io/imaginary-map/images-small/architecture/preview.png)](https://anvaka.github.io/imaginary-map/architecture/)

[link](https://anvaka.github.io/imaginary-map/architecture/)

You can see them as a list too: https://anvaka.github.io/imaginary-map/architecture/List.html

## Imagine most stereotypical person in `X`

[![preview](https://anvaka.github.io/imaginary-faces/preview.png)](https://anvaka.github.io/imaginary-faces/)

[link](https://anvaka.github.io/imaginary-faces/)

## Disclaimers

Please be aware that:

1. These images are not depictions of real individuals, and the AI was specifically prompted to generate stereotypical (or biased) images.
2. The generated images are not representative of the diverse and complex populations of each country.
3. This project is a product of curiosity about how a machine learning model might "view" the world.

## Tech stack

Each image was created by manually entering a query for every country. 
The resulting high-definition images amounted to 900MB of disk space, which were then compressed using https://squoosh.app/

The map is rendered using [maplibre](https://maplibre.org/) and [natural earth](https://www.naturalearthdata.com/) data.

Each image is clipped to its country's shape in the browser, in web workers.
Images load small first, 256 pixels wide, then sharper (512 and 1024) for the
countries you zoom into. The countries on screen load first, the biggest of them
first.

## Running it locally

```sh
npm install
npm run dev     # http://localhost:5174/architecture/ and /cyberpunk/
npm run build   # static site in dist/
```

The images are in `public/images-small/<map>/`. After adding or replacing one,
write its smaller sizes with `python3 scripts/make-sizes.py <map>`.

Every push to `main` deploys to GitHub Pages. Every pull request gets a preview at
`https://anvaka.github.io/imaginary-map/pr-preview/pr-<number>/`.

## Feedback

Your feedback is invaluable to the improvement of this project. 
If you have any suggestions or comments, please feel free to leave them as an issue here, 
or contact me on Twitter at  https://twitter.com/anvaka

## Community discussion

* [Imaginary faces](https://www.reddit.com/r/MapPorn/comments/14ynj3s/asked_midjourney_to_imagine_the_most/)
* [Futuristic architecture](https://www.reddit.com/r/MapPorn/comments/162wf6s/midjourney_imagines_futuristic_architecture_of/) - almost no discussion here


Please follow the comments trail to see what people think about it.

## License

The source code in this project is licensed under MIT license. 
